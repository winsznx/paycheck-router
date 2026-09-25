import {
  buildMessage,
  fetchRouter,
  findPaycheckPda,
  getRecordPaycheckInstructionAsync,
  latestLifetime,
  signSendConfirm,
  simulate,
} from "@paycheck-router/sdk";
import { TOKEN_PROGRAM_ID, USDC_DECIMALS, USDC_MINT } from "@paycheck-router/shared";
import { generateKeyPairSigner } from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getInitializeAccount3Instruction,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import { toJson } from "../../lib/bundle.ts";
import { type CaseContext, type CaseDefinition, requireFork } from "../lib/case.ts";
import { probe } from "../lib/manifest.ts";
import {
  type PaycheckResult,
  runPaycheck,
  setupRouter,
  snapshotAccount,
  type WorkerRouter,
} from "../lib/paycheck.ts";
import { accountAbsentProbe, balancesProbe, caseRef, observedFailure } from "../lib/probes.ts";

const USDC = 1_000_000n;
const TOKEN_ACCOUNT_SPACE = 165n;

function classificationProbe(
  ctx: CaseContext,
  result: PaycheckResult,
  router: WorkerRouter,
  expected: string,
  taggedPayers: string[],
) {
  const send = result.manifest.transactions.find((t) => t.label.startsWith("paycheck:"));
  if (!send?.raw) throw new Error(`${result.entry.label}: the inflow transaction was not stored`);
  ctx.probes.push(
    probe({
      name: `${result.entry.label} / classification`,
      description: "The crank's inflow decision under the owner's rules",
      expected: [expected],
      observed: `classification:${result.entry.classification}`,
      source: {
        kind: "classification",
        transaction: caseRef(result, send.raw),
        payIn: router.payIn,
        owner: router.owner.address,
        authority: router.authority,
        minimum: router.minInflow.toString(),
        taggedPayersOnly: true,
        taggedPayers,
      },
      signature: send.signature,
    }),
  );
}

async function noPaycheckProbe(ctx: CaseContext, router: WorkerRouter, label: string) {
  const fork = requireFork(ctx);
  const state = await fetchRouter(fork.surfnet.rpc, router.router);
  const next = await findPaycheckPda(router.router, state.data.paycheckSeq);
  const read = await snapshotAccount(
    fork,
    ctx.bundle,
    next,
    `raw/accounts/${label.replaceAll(" ", "-")}-paycheck.json`,
  );
  accountAbsentProbe(
    ctx,
    `${label} / no paycheck`,
    "The router's next Paycheck account does not exist",
    read.ref,
    read.value,
    next,
  );
}

/** PRD 23.4 P2: inflows that are not paychecks move nothing. */
export const p2Control: CaseDefinition = {
  module: "p2-control",
  caseId: "P2",
  title: "Healthy control",
  scenario:
    "Router with tagged-payers-only (employer-1) and a 5 USDC minimum: $50 from untagged " +
    "employer-2, $2 from employer-1, and $30 the worker moves in from its own second account",
  expected: "Skipped or no paycheck; nothing moves",
  needsFork: true,
  async run(ctx) {
    const fork = requireFork(ctx);
    const worker = ctx.signers["demo-worker"];
    const router = await setupRouter(ctx, {
      name: "demo-worker",
      legs: [{ symbol: "Anthropic", weightBps: 10_000, bandBps: 300 }],
      investBps: 5_000,
      minInflow: 5n * USDC,
    });
    const tagged = new Set([ctx.signers["employer-1"].address]);
    const rules = { taggedPayersOnly: true, taggedPayers: tagged, appThreshold: 5n * USDC };

    const untagged = await runPaycheck(ctx, router, {
      label: "untagged sender",
      employer: "employer-2",
      employerSigner: ctx.signers["employer-2"],
      amount: 50n * USDC,
      rules,
    });
    classificationProbe(ctx, untagged, router, "classification:untagged_sender", [...tagged]);
    await noPaycheckProbe(ctx, router, "untagged sender");
    balancesProbe(
      ctx,
      untagged,
      50n * USDC,
      "Only the inflow landed; no USDC left, no shares bought",
    );

    const small = await runPaycheck(ctx, router, {
      label: "below minimum",
      employer: "employer-1",
      employerSigner: ctx.signers["employer-1"],
      amount: 2n * USDC,
      rules,
      detectTimeoutMs: 12_000,
    });
    classificationProbe(ctx, small, router, "classification:not_detected", [...tagged]);
    const state = await fetchRouter(fork.surfnet.rpc, router.router);
    const record = await getRecordPaycheckInstructionAsync({
      recorder: ctx.signers.recorder,
      payer: ctx.signers.crank,
      router: router.router,
      payIn: router.payIn,
      paycheck: await findPaycheckPda(router.router, state.data.paycheckSeq),
      detectedSlot: await fork.surfnet.rpc.getSlot({ commitment: "confirmed" }).send(),
    });
    const simulation = await simulate(
      fork.surfnet.rpc,
      buildMessage(ctx.signers.crank, await latestLifetime(fork.surfnet.rpc), [record]),
    );
    const logs = ctx.bundle.write(
      "raw/simulation/record-below-minimum.json",
      toJson({ err: simulation.err, logs: simulation.logs }),
    );
    ctx.probes.push(
      probe({
        name: "below minimum / record_paycheck refused onchain",
        description: "A recorder that tried anyway is refused by the program",
        expected: ["error:InflowBelowMinimum"],
        observed: observedFailure(simulation.err, simulation.logs),
        source: { kind: "program_error", logs },
      }),
    );
    await noPaycheckProbe(ctx, router, "below minimum");
    balancesProbe(ctx, small, 2n * USDC, "Only the inflow landed; no USDC left, no shares bought");

    const second = await generateKeyPairSigner();
    ctx.extraKeys["worker-second-usdc-account"] = second.address;
    const [employerUsdc] = await findAssociatedTokenPda({
      owner: ctx.signers["employer-1"].address,
      mint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    const rent = await fork.surfnet.rpc
      .getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SPACE)
      .send();
    const funded = await signSendConfirm(
      fork.surfnet.rpc,
      buildMessage(ctx.signers.sponsor, await latestLifetime(fork.surfnet.rpc), [
        getCreateAccountInstruction({
          payer: ctx.signers.sponsor,
          newAccount: second,
          lamports: rent,
          space: TOKEN_ACCOUNT_SPACE,
          programAddress: TOKEN_PROGRAM_ID,
        }),
        getInitializeAccount3Instruction({
          account: second.address,
          mint: USDC_MINT,
          owner: worker.address,
        }),
        getTransferCheckedInstruction({
          source: employerUsdc,
          mint: USDC_MINT,
          destination: second.address,
          authority: ctx.signers["employer-1"],
          amount: 30n * USDC,
          decimals: USDC_DECIMALS,
        }),
      ]),
    );
    await fork.transactions.add("fund the worker's second USDC account", funded.signature);
    const self = await runPaycheck(ctx, router, {
      label: "self transfer",
      employer: "demo-worker (own second account)",
      employerSigner: worker,
      amount: 30n * USDC,
      rules,
      send: async () => {
        const moved = await signSendConfirm(
          fork.surfnet.rpc,
          buildMessage(ctx.signers.sponsor, await latestLifetime(fork.surfnet.rpc), [
            getTransferCheckedInstruction({
              source: second.address,
              mint: USDC_MINT,
              destination: router.payIn,
              authority: worker,
              amount: 30n * USDC,
              decimals: USDC_DECIMALS,
            }),
          ]),
        );
        return { signature: moved.signature };
      },
    });
    classificationProbe(ctx, self, router, "classification:self_transfer", [...tagged]);
    await noPaycheckProbe(ctx, router, "self transfer");
    balancesProbe(ctx, self, 30n * USDC, "Only the inflow landed; no USDC left, no shares bought");
  },
};
