import {
  attemptLeg,
  decodeLegExecuted,
  executeInstructionBuilder,
  JsonRpcError,
  jsonRpc,
  newMarkState,
  recordPaycheck,
} from "@paycheck-router/sdk";
import { toJson } from "../../lib/bundle.ts";
import { type CaseDefinition, requireFork } from "../lib/case.ts";
import { probe } from "../lib/manifest.ts";
import { runPaycheck, setupRouter, snapshotBalances } from "../lib/paycheck.ts";
import { deliveryProbe, expectLegs, movementProbe, observedFailure } from "../lib/probes.ts";
import { withPrices } from "../lib/test-crank.ts";

const USDC = 1_000_000n;
const ALREADY_PROCESSED = /already (been )?processed|AlreadyProcessed/i;

/**
 * PRD 23.4 P6: after a paycheck is recorded and its leg executed, the crank resubmits
 * `record_paycheck` and `execute_leg`, freshly built, and the executed transaction's exact
 * signed bytes. The program refuses the first two; the node refuses the third.
 */
export const p6Replay: CaseDefinition = {
  module: "p6-replay",
  caseId: "P6",
  title: "Replay",
  scenario:
    "A $200 paycheck, half to Anthropic, executes; then record_paycheck and execute_leg are " +
    "resubmitted and the executed transaction is re-sent byte for byte",
  expected: "NoNewInflow; LegNotPending",
  needsFork: true,
  async run(ctx) {
    const fork = requireFork(ctx);
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
    });
    expectLegs(ctx, result, ["Anthropic"], ["leg:VERIFIED"], "The original leg executes");
    for (const outcome of result.legs) deliveryProbe(ctx, result, outcome);
    const executed = result.legs.find((l) => l.record.executed);
    if (!executed?.record.executed || !result.pipeline || !result.paycheck) {
      ctx.notes.push("the original leg did not execute, so there is nothing to replay");
      return;
    }
    const before = await snapshotBalances(fork, ctx.bundle, router, "before-replays");

    const again = await recordPaycheck(fork.surfnet.rpc, {
      recorder: ctx.signers.recorder,
      payer: ctx.signers.crank,
      router: router.router,
      payIn: router.payIn,
      detectedSlot: await fork.surfnet.rpc.getSlot({ commitment: "confirmed" }).send(),
    });
    const { raw: recordRaw, result: recordTx } = await jsonRpc<{
      meta: { err: unknown; logMessages: string[] | null };
    } | null>(fork.surfnet.rpcUrl, "getTransaction", [
      again.outcome.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ]);
    await fork.transactions.add("replay: record_paycheck", again.outcome.signature);
    const recordRef = ctx.bundle.write(`raw/replay/record-paycheck.json`, recordRaw);
    ctx.probes.push(
      probe({
        name: "replay / record_paycheck",
        description: "A second record_paycheck for the same inflow",
        expected: ["error:NoNewInflow"],
        observed: observedFailure(
          recordTx?.meta.err ?? again.outcome.err,
          recordTx?.meta.logMessages ?? [],
        ),
        source: { kind: "program_error", logs: recordRef },
        signature: again.outcome.signature,
      }),
    );

    const pipeline = result.pipeline;
    const treasury = fork.protocol.treasury;
    const replay = await withPrices(fork, pipeline, [executed.leg], (prices) =>
      attemptLeg(
        pipeline,
        executed.leg,
        executed.attempts.length,
        async () => prices,
        newMarkState(),
        executeInstructionBuilder({ treasury }),
        decodeLegExecuted,
      ),
    );
    const simRef = ctx.bundle.write(
      "raw/replay/execute-leg-simulation.json",
      toJson({ err: replay.simulation?.err ?? null, logs: replay.simulation?.logs ?? [] }),
    );
    if (replay.jupiter) ctx.bundle.write("raw/replay/execute-leg-jupiter.json", replay.jupiter.raw);
    ctx.probes.push(
      probe({
        name: "replay / execute_leg",
        description: "The crank's pipeline builds and simulates execute_leg for the executed leg",
        expected: ["error:LegNotPending"],
        observed: replay.simulation
          ? observedFailure(replay.simulation.err, replay.simulation.logs)
          : `not simulated: ${replay.error}`,
        source: { kind: "program_error", logs: simRef },
        signature: replay.signature,
      }),
    );

    const signature = executed.record.executed.signature;
    const { result: wire } = await jsonRpc<{ transaction: [string, string] } | null>(
      fork.surfnet.rpcUrl,
      "getTransaction",
      [
        signature,
        { encoding: "base64", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
      ],
    );
    let refusal: string;
    let response: unknown;
    try {
      const sent = await jsonRpc<string>(fork.surfnet.rpcUrl, "sendTransaction", [
        wire?.transaction[0],
        { encoding: "base64" },
      ]);
      response = JSON.parse(sent.raw);
      refusal = "rpc:accepted";
    } catch (caught) {
      response =
        caught instanceof JsonRpcError
          ? { error: { code: caught.code, message: caught.rpcMessage, data: caught.data } }
          : { error: String(caught) };
      refusal = ALREADY_PROCESSED.test(String(caught instanceof Error ? caught.message : caught))
        ? "rpc:already_processed"
        : `rpc:refused:${caught instanceof Error ? caught.message.slice(0, 120) : String(caught)}`;
    }
    const resendRef = ctx.bundle.write(
      "raw/replay/resend-signed-bytes.json",
      toJson({ signature, transactionBase64: wire?.transaction[0] ?? null, response }),
    );
    ctx.probes.push(
      probe({
        name: "replay / identical signed bytes",
        description: "The executed transaction re-sent byte for byte",
        expected: ["rpc:already_processed"],
        observed: refusal,
        source: { kind: "rpc_refusal", response: resendRef },
        signature,
      }),
    );

    const after = await snapshotBalances(fork, ctx.bundle, router, "after-replays");
    movementProbe(
      ctx,
      "replays / nothing moved",
      "No USDC or shares moved during the replays",
      before,
      after,
      0n,
    );
  },
};
