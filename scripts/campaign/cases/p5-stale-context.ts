import { buyMinOut, multiplierToE12 } from "@paycheck-router/guard-math";
import {
  attestMark,
  fetchPreStocks,
  jsonRpc,
  type LegExecutedEvent,
  legExecutedFromLogs,
} from "@paycheck-router/sdk";
import type { ArtifactRef } from "@paycheck-router/shared";
import { type Address, getBase64Encoder } from "@solana/kit";
import { toJson } from "../../lib/bundle.ts";
import { type CaseContext, type CaseDefinition, type ForkState, requireFork } from "../lib/case.ts";
import { probe } from "../lib/manifest.ts";
import { readScaledUiAmount, withPendingMultiplier } from "../lib/mint.ts";
import { runPaycheck, setupRouter, snapshotAccount } from "../lib/paycheck.ts";
import { caseRef, expectLegs, programErrorProbe } from "../lib/probes.ts";
import { observedError, runTamperedLeg, withPrices } from "../lib/test-crank.ts";

const USDC = 1_000_000n;
/** Seconds past the 300 s attestation limit before the old attestation is used. */
const STALE_AFTER_SECS = 305;
/** When the new multiplier takes effect, counted from the change. */
const MULTIPLIER_DELAY_SECS = 75;
/** A 5% multiplier step, the size of a stock dividend or small split adjustment. */
const MULTIPLIER_STEP = 1.05;

const sleepUntil = (unixMs: number) =>
  new Promise((r) => setTimeout(r, Math.max(0, unixMs - Date.now())));

async function mintData(fork: ForkState, mint: Address): Promise<Uint8Array> {
  const { result } = await jsonRpc<{ value: { data: [string, string] } | null }>(
    fork.surfnet.rpcUrl,
    "getAccountInfo",
    [mint, { encoding: "base64", commitment: "confirmed" }],
  );
  if (!result.value) throw new Error(`mint ${mint} not found`);
  return Uint8Array.from(getBase64Encoder().encode(result.value.data[0]));
}

/** Which multiplier an event's minimum used, re-computed with the reference model. */
function multiplierUsed(event: LegExecutedEvent, oldE12: bigint, newE12: bigint, decimals: number) {
  const recomputed = buyMinOut({
    usdcIn: event.swappedIn,
    usdcPriceE9: event.usdcPriceE9,
    priceE9: event.refPriceE9,
    bandBps: event.bandBps,
    multiplierE12: event.multiplierE12,
    decimals,
  });
  if (recomputed !== event.minOut) return "min_out:mismatch";
  if (event.multiplierE12 === newE12) return "min_out:new_multiplier";
  if (event.multiplierE12 === oldE12) return "min_out:old_multiplier";
  return "min_out:other_multiplier";
}

/**
 * PRD 23.4 P5 with real waits instead of `surfnet_timeTravel`: moving the fork clock ahead of
 * wall time makes every Pyth price Hermes can serve stale against the program's 30 s limit, so a
 * leg could not execute after the jump. The attestation is signed, then used 305 s later; the
 * Anthropic mint gets a pending multiplier change (the issuer authority's action, done here by
 * cheatcode) that takes effect 75 s later.
 */
export const p5StaleContext: CaseDefinition = {
  module: "p5-stale-context",
  caseId: "P5",
  title: "Stale context",
  scenario:
    "A $200 paycheck split between Kalshi and Anthropic PreStocks. Kalshi's execute carries an " +
    "attestation signed 305 s earlier; Anthropic's mint gets a 1.05x Scaled UI multiplier that " +
    "takes effect while the leg is pending",
  expected: "AttestationStale; the minimum uses the new multiplier",
  needsFork: true,
  async run(ctx: CaseContext) {
    const fork = requireFork(ctx);
    const router = await setupRouter(ctx, {
      name: "demo-worker",
      legs: [
        { symbol: "Kalshi", weightBps: 5_000, bandBps: 300 },
        { symbol: "Anthropic", weightBps: 5_000, bandBps: 300 },
      ],
      investBps: 10_000,
    });
    let mintAfter: ArtifactRef | null = null;
    let oldE12 = 0n;
    let newE12 = 0n;
    const result = await runPaycheck(ctx, router, {
      label: "Kalshi+Anthropic paycheck",
      employer: "employer-1",
      employerSigner: ctx.signers["employer-1"],
      amount: 200n * USDC,
      beforeExecute: async ({ pending, pipeline, treasury }) => {
        const kalshi = pending.find((l) => l.asset.symbol === "Kalshi");
        const anthropic = pending.find((l) => l.asset.symbol === "Anthropic");
        if (!kalshi || !anthropic) throw new Error("both legs must be pending");
        const signedAtMs = Date.now();
        const read = await fetchPreStocks();
        ctx.bundle.write("raw/prestocks/stale-read.json", read.raw);
        const { signed: stale } = await attestMark(read, kalshi.asset.mint, ctx.signers.attester);
        ctx.log(`Kalshi attestation signed, observed_at ${read.observedAt}`);

        const mint = anthropic.asset.mint;
        await snapshotAccount(fork, ctx.bundle, mint, "raw/accounts/anthropic-mint-before.json");
        const original = await mintData(fork, mint);
        const config = readScaledUiAmount(original);
        const effective = BigInt(Math.floor(Date.now() / 1000) + MULTIPLIER_DELAY_SECS);
        const newMultiplier = config.multiplier * MULTIPLIER_STEP;
        await fork.surfnet.cheat.setAccount(mint, {
          data: withPendingMultiplier(original, newMultiplier, effective),
        });
        ctx.bundle.write(
          "raw/cheatcodes/anthropic-multiplier.json",
          toJson({
            cheatcode: "surfnet_setAccount",
            mint,
            before: config,
            newMultiplier,
            newMultiplierEffectiveTimestamp: effective,
          }),
        );
        mintAfter = (
          await snapshotAccount(fork, ctx.bundle, mint, "raw/accounts/anthropic-mint-after.json")
        ).ref;
        oldE12 = multiplierToE12(config.multiplier, "down");
        newE12 = multiplierToE12(newMultiplier, "down");

        await withPrices(fork, pipeline, [anthropic], async (prices) => {
          const fresh = await attestMark(await fetchPreStocks(), mint, ctx.signers.attester);
          const run = await runTamperedLeg(
            fork,
            ctx.bundle,
            pipeline,
            anthropic,
            prices,
            treasury,
            "anthropic-before-multiplier",
            { attestation: fresh.signed },
            false,
          );
          const [event] = legExecutedFromLogs(run.simulation.logs);
          ctx.probes.push(
            probe({
              name: "Anthropic before the change",
              description:
                "Simulated before the new multiplier's timestamp: the minimum uses the old one",
              expected: ["min_out:old_multiplier"],
              observed: event
                ? multiplierUsed(event, oldE12, newE12, anthropic.asset.decimals)
                : observedError(run),
              source: {
                kind: "min_out_multiplier",
                transaction: run.simulationRef,
                mintAfter: mintAfter ?? run.simulationRef,
                decimals: anthropic.asset.decimals,
              },
            }),
          );
        });

        await sleepUntil(signedAtMs + STALE_AFTER_SECS * 1000);
        await withPrices(fork, pipeline, [kalshi], async (prices) => {
          const run = await runTamperedLeg(
            fork,
            ctx.bundle,
            pipeline,
            kalshi,
            prices,
            treasury,
            "kalshi-stale-attestation",
            { attestation: stale },
            true,
          );
          if (run.signature) {
            await fork.transactions.add("stale attestation execute", run.signature);
          }
          programErrorProbe(
            ctx,
            "Kalshi with a 305 s old attestation",
            "The attestation is older than 300 s when the program reads it",
            ["error:AttestationStale"],
            run,
            observedError(run),
          );
        });
        await sleepUntil(Number(effective) * 1000 + 3_000);
      },
    });

    expectLegs(
      ctx,
      result,
      ["Kalshi"],
      ["leg:VERIFIED", "leg:WAITING:PREMIUM_TOO_HIGH"],
      "The crank signs a fresh attestation and the leg proceeds past the staleness check",
    );
    const anthropic = result.legs.find((l) => l.record.symbol === "Anthropic");
    const executed = anthropic?.record.executed;
    const event = anthropic?.attempts.at(-1)?.event;
    if (anthropic && executed && event && mintAfter) {
      ctx.probes.push(
        probe({
          name: "Anthropic after the change",
          description:
            "Executed after the new multiplier's timestamp: the minimum uses the new one",
          expected: ["min_out:new_multiplier"],
          observed: multiplierUsed(event, oldE12, newE12, anthropic.leg.asset.decimals),
          source: {
            kind: "min_out_multiplier",
            transaction: caseRef(result, executed.transaction),
            mintAfter,
            decimals: anthropic.leg.asset.decimals,
          },
          signature: executed.signature,
        }),
      );
    } else {
      expectLegs(
        ctx,
        result,
        ["Anthropic"],
        ["leg:VERIFIED"],
        "Anthropic executes after the multiplier change",
      );
    }
    ctx.notes.push(
      "P5 fills trade against a cheatcode-modified mint and are left out of the headline cost",
    );
  },
};
