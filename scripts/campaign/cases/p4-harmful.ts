import { attestMark, fetchPreStocks } from "@paycheck-router/sdk";
import { TOKEN_PROGRAM_ID, USDC_MINT } from "@paycheck-router/shared";
import { findAssociatedTokenPda } from "@solana-program/token-2022";
import { type CaseDefinition, requireFork } from "../lib/case.ts";
import { probe } from "../lib/manifest.ts";
import { runPaycheck, setupRouter, snapshotBalances } from "../lib/paycheck.ts";
import { expectLegs, movementProbe, programErrorProbe } from "../lib/probes.ts";
import {
  observedError,
  type ProbeRun,
  replaceAccount,
  type Tamper,
  tamperedLeg,
} from "../lib/test-crank.ts";

const USDC = 1_000_000n;

/**
 * PRD 23.4 P4 harmful action: a test crank submits routes that pay another account or pull
 * extra USDC from the owner. Each goes onchain; the program must refuse all of them and nothing
 * may move. The honest crank then executes the same leg, which shows the route itself was sound.
 */
export const p4Harmful: CaseDefinition = {
  module: "p4-harmful",
  caseId: "P4",
  title: "Harmful action",
  scenario:
    "After a $200 paycheck is recorded (half to Anthropic), a test crank sends three tampered " +
    "execute transactions: shares routed to the ops key's account with the ops account as the " +
    "destination, shares routed to the ops key's account with the owner's account as the " +
    "destination, and a route whose source is the owner's pay-in account instead of the " +
    "Authority's",
  expected: "DestinationOwnerMismatch or OutputBelowMinimum; InputOverspent",
  needsFork: true,
  async run(ctx) {
    const fork = requireFork(ctx);
    const attacker = ctx.signers.ops.address;
    const router = await setupRouter(ctx, {
      name: "demo-worker",
      legs: [{ symbol: "Anthropic", weightBps: 10_000, bandBps: 300 }],
      investBps: 5_000,
    });
    const result = await runPaycheck(ctx, router, {
      label: "Anthropic paycheck",
      employer: "employer-1",
      employerSigner: ctx.signers["employer-1"],
      amount: 200n * USDC,
      beforeExecute: async ({ pending, pipeline, treasury }) => {
        const [leg] = pending;
        if (!leg) throw new Error("no pending leg to attack");
        const before = await snapshotBalances(fork, ctx.bundle, router, "before-attacks");
        const read = await fetchPreStocks();
        const { signed } = await attestMark(read, leg.asset.mint, ctx.signers.attester);
        ctx.bundle.write("raw/prestocks/attacks.json", read.raw);
        const [authorityUsdc] = await findAssociatedTokenPda({
          owner: router.authority,
          mint: USDC_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
        });
        const attacks: { name: string; description: string; expected: string[]; tamper: Tamper }[] =
          [
            {
              name: "shares to another account",
              description:
                "Jupiter pays the ops key's account and execute_leg is given that account",
              expected: ["error:DestinationOwnerMismatch"],
              tamper: {
                jupiterRecipient: attacker,
                executeRecipient: attacker,
                attestation: signed,
              },
            },
            {
              name: "shares diverted, owner named",
              description:
                "Jupiter pays the ops key's account while execute_leg is given the owner's",
              expected: ["error:OutputBelowMinimum", "error:DestinationOwnerMismatch"],
              tamper: { jupiterRecipient: attacker, attestation: signed },
            },
            {
              name: "route pulls extra USDC",
              description:
                "The swap's source is the owner's pay-in account, which the Authority can spend as delegate",
              expected: ["error:InputOverspent"],
              tamper: {
                attestation: signed,
                swap: (swap) => replaceAccount(swap, authorityUsdc, router.payIn),
              },
            },
          ];
        for (const attack of attacks) {
          let run: ProbeRun;
          try {
            run = await tamperedLeg(
              fork,
              ctx.bundle,
              pipeline,
              leg,
              treasury,
              attack.name.replaceAll(" ", "-"),
              attack.tamper,
              true,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.log(`${attack.name}: the test crank could not build or send it: ${message}`);
            ctx.probes.push(
              probe({
                name: `attack / ${attack.name}`,
                description: attack.description,
                expected: attack.expected,
                observed: `crash:${message.slice(0, 200)}`,
                source: { kind: "computed", artifacts: [] },
              }),
            );
            continue;
          }
          if (run.signature) await fork.transactions.add(`attack: ${attack.name}`, run.signature);
          ctx.log(`${attack.name}: ${observedError(run)} (${run.status})`);
          programErrorProbe(
            ctx,
            `attack / ${attack.name}`,
            attack.description,
            attack.expected,
            run,
            observedError(run),
          );
        }
        const after = await snapshotBalances(fork, ctx.bundle, router, "after-attacks");
        movementProbe(
          ctx,
          "attacks / nothing moved",
          "The owner's USDC and shares are unchanged across the three attacks",
          before,
          after,
          0n,
        );
      },
    });
    expectLegs(
      ctx,
      result,
      ["Anthropic"],
      ["leg:VERIFIED"],
      "After the refused attacks, the honest crank executes the same leg and it is Verified",
    );
  },
};
