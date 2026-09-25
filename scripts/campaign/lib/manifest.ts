import {
  AddressString,
  ArtifactRef,
  IntegerString,
  Sha256Hex,
  SignatureString,
  TransactionRecord,
} from "@paycheck-router/shared";
import { z } from "zod";

export const CAMPAIGN_DIR = "evidence/campaign";
export const SUMMARY_FILE = "summary.json";

/**
 * How `pnpm verify:campaign` re-derives a probe's observed value from raw artifacts, without the
 * crank's code. Paths are relative to the case bundle.
 */
export const ProbeSource = z.discriminatedUnion("kind", [
  /** A simulation or transaction response whose logs name the failing program and code. */
  z.object({ kind: z.literal("program_error"), logs: ArtifactRef }),
  /** Whether a JSON-RPC send was refused, and the refusal message. */
  z.object({ kind: z.literal("rpc_refusal"), response: ArtifactRef }),
  /** One leg of a paycheck sub-bundle, by its manifest path. */
  z.object({ kind: z.literal("leg"), bundle: z.string(), legIndex: z.number().int() }),
  /** `getMultipleAccounts` (jsonParsed) before and after, plus the inflow the owner received. */
  z.object({
    kind: z.literal("balances"),
    before: ArtifactRef,
    after: ArtifactRef,
    inflow: IntegerString,
  }),
  /** A `getAccountInfo` response that must hold no account. */
  z.object({ kind: z.literal("account_absent"), read: ArtifactRef }),
  /** The inflow and the owner's rules, re-classified independently. */
  z.object({
    kind: z.literal("classification"),
    transaction: ArtifactRef,
    payIn: AddressString,
    owner: AddressString,
    authority: AddressString,
    minimum: IntegerString,
    taggedPayersOnly: z.boolean(),
    taggedPayers: z.array(AddressString),
  }),
  /** A `LegExecuted` event's minimum re-computed with the multiplier the mint reports. */
  z.object({
    kind: z.literal("min_out_multiplier"),
    transaction: ArtifactRef,
    mintAfter: ArtifactRef,
    decimals: z.number().int(),
  }),
  /** An executed leg's transaction: gross delivery against the event's minimum. */
  z.object({ kind: z.literal("delivery"), transaction: ArtifactRef }),
  /** Numbers the summary re-derives from these artifacts (P7). */
  z.object({ kind: z.literal("computed"), artifacts: z.array(ArtifactRef) }),
  /** A Hermes response that was refused (HTTP status and body). */
  z.object({ kind: z.literal("http_refusal"), response: ArtifactRef }),
]);
export type ProbeSource = z.infer<typeof ProbeSource>;

/**
 * One pre-registered expectation and what the run observed. `expected` lists the acceptable
 * observations; the probe passes when `observed` is one of them.
 */
export const Probe = z.object({
  name: z.string(),
  description: z.string(),
  expected: z.array(z.string()).min(1),
  observed: z.string(),
  pass: z.boolean(),
  source: ProbeSource,
  signature: SignatureString.nullable(),
});
export type Probe = z.infer<typeof Probe>;

export const PaycheckEntry = z.object({
  label: z.string(),
  employer: z.string(),
  employerAddress: AddressString,
  worker: z.string(),
  workerAddress: AddressString,
  router: AddressString,
  amount: IntegerString,
  /** The paycheck's own RunManifest (the shared evidence schema), relative to the case bundle. */
  bundle: ArtifactRef,
  classification: z.string().nullable(),
  recorded: z.boolean(),
  error: z.string().nullable(),
});
export type PaycheckEntry = z.infer<typeof PaycheckEntry>;

export const CaseManifest = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("campaign-case"),
  caseId: z.string(),
  module: z.string(),
  runId: z.string(),
  environment: z.literal("fork"),
  title: z.string(),
  scenario: z.string(),
  expected: z.string(),
  fork: z
    .object({
      startSlot: z.number().int(),
      rpcUrl: z.string(),
      datasource: z.string(),
      surfpoolVersion: z.string(),
      clockDriftSecs: z.number(),
    })
    .nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  commit: z.string(),
  programId: AddressString,
  programSha256: Sha256Hex.nullable(),
  /** `solana-verify get-executable-hash` of the deployed binary. */
  programExecutableHash: Sha256Hex.nullable(),
  programSource: z.string().nullable(),
  crankVersion: z.string(),
  rpc: z.object({ sender: z.string(), verifier: z.string() }),
  keys: z.record(z.string(), AddressString),
  setup: z.array(TransactionRecord),
  paychecks: z.array(PaycheckEntry),
  probes: z.array(Probe),
  /** Other bundles this case reads (P7 replays the fork runs' recorded quotes). */
  inputs: z.array(ArtifactRef),
  observed: z.object({ outcome: z.string(), pass: z.boolean(), notes: z.array(z.string()) }),
  artifacts: z.array(ArtifactRef),
  error: z.string().nullable(),
});
export type CaseManifest = z.infer<typeof CaseManifest>;

export function probe(
  fields: Omit<Probe, "pass" | "signature"> & { signature?: string | null },
): Probe {
  return Probe.parse({
    ...fields,
    signature: fields.signature ?? null,
    pass: fields.expected.includes(fields.observed),
  });
}
