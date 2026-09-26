/**
 * One-time bootstrap of the hosted demo fork: deploys the program under its production id,
 * initializes Config, seeds the registry and lookup table, funds the fork-only role keys, and
 * exports a Surfpool snapshot that every later reset of the hosted fork starts from.
 *
 * Runs against a surfnet reached through an SSH tunnel, e.g.
 *   ssh -N -L 28899:127.0.0.1:18899 -L 28900:127.0.0.1:18900 root@<vps>
 *   HOSTED_RPC_PORT=28899 PROGRAM_SO=... pnpm tsx scripts/hosted-demo/bootstrap.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bigintReplacer, createRpc, SurfnetCheatcodes } from "@paycheck-router/sdk";
import { type Address, address } from "@solana/kit";
import {
  clockDriftSecs,
  deployProgram,
  fundForkKeys,
  initializeProtocol,
  loadForkSigners,
  type Surfnet,
} from "../lib/fork.ts";

const rpcPort = Number(process.env.HOSTED_RPC_PORT ?? 28899);
const wsPort = rpcPort + 1;
const rpcUrl = `http://127.0.0.1:${rpcPort}`;
const out = process.env.SNAPSHOT_OUT ?? resolve(process.cwd(), "bootstrap-snapshot.json");

const rpc = createRpc(rpcUrl);
const surfnet: Surfnet = {
  rpcUrl,
  wsUrl: `ws://127.0.0.1:${wsPort}`,
  rpcPort,
  wsPort,
  datasource: "hosted demo (VPS)",
  surfpoolVersion: "surfpool 1.5.0",
  startSlot: await rpc.getSlot().send(),
  clockDriftSecs: await clockDriftSecs(rpcUrl),
  rpc,
  cheat: new SurfnetCheatcodes(rpcUrl),
  stop: async () => {},
};

/**
 * The surfnet's account map in the format `surfpool start --snapshot` reads. Integers above
 * 2^53 (rent epochs of u64::MAX) keep their exact digits, and upgradeable programs are added
 * with their program-data accounts, which surfnet_exportSnapshot leaves out.
 */
/** Node 22+ JSON.rawJSON, not yet in TypeScript's lib typings. */
const { rawJSON } = JSON as JSON & { rawJSON(text: string): unknown };

async function exportAccounts(programs: Address[]): Promise<string> {
  const exact = (text: string) =>
    JSON.parse(text, (_key, value, context?: { source?: string }) =>
      typeof value === "number" && !Number.isSafeInteger(value) && context?.source
        ? rawJSON(context.source)
        : value,
    );
  const call = async (method: string, params: unknown[]) => {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return exact(await res.text()).result;
  };
  const snapshot = await call("surfnet_exportSnapshot", []);
  const accounts = snapshot.value ?? snapshot;
  for (const program of programs) {
    const parsed = await call("getAccountInfo", [program, { encoding: "jsonParsed" }]);
    const programData = address(parsed.value.data.parsed.info.programData);
    for (const key of [program, programData]) {
      const { value } = await call("getAccountInfo", [key, { encoding: "base64" }]);
      accounts[key] = {
        lamports: value.lamports,
        owner: value.owner,
        executable: value.executable,
        rentEpoch: value.rentEpoch,
        data: value.data[0],
        parsedData: null,
      };
    }
  }
  return JSON.stringify(accounts);
}

const signers = await loadForkSigners();
await fundForkKeys(surfnet, signers);
const deployment = await deployProgram(surfnet);
const protocol = await initializeProtocol(surfnet, signers);

writeFileSync(out, await exportAccounts([deployment.programId]));
console.log(
  JSON.stringify(
    {
      programId: deployment.programId,
      programSha256: deployment.sha256,
      config: protocol.config,
      treasury: protocol.treasury,
      lookupTable: protocol.lookupTable.address,
      startSlot: surfnet.startSlot,
      snapshot: out,
    },
    bigintReplacer,
    2,
  ),
);
