import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { getBase58Decoder } from "@solana/kit";
import { startDemoDatabase } from "./lib/demo-db.ts";
import { writeCoreDevVars } from "./lib/dev-vars.ts";
import {
  deployProgram,
  fundForkKeys,
  initializeProtocol,
  loadForkSigners,
  sendPaycheck,
  startSurfnet,
} from "./lib/fork.ts";

/**
 * `pnpm demo:record`: a fresh surfnet with the program deployed under the production program ID,
 * Config initialized and fork-only keys funded; then core (`wrangler dev --env demo`), web
 * (`next dev`) and the demo database. Press P to send the paycheck, Q to stop.
 */

const ROOT = resolve(import.meta.dirname, "..");
const KEYS_DIR = process.env.PAYCHECK_ROUTER_KEYS_DIR ?? resolve(ROOT, "internal", "keys");
const SECRETS_DIR = process.env.PAYCHECK_ROUTER_SECRETS_DIR ?? resolve(ROOT, "internal", "secrets");
/** Ports can move so a second copy can run beside the recording; the defaults are the recording's. */
const RPC_PORT = Number(process.env.DEMO_SURFNET_PORT ?? 8899);
const CORE_PORT = Number(process.env.DEMO_CORE_PORT ?? 8787);
const DB_PORT = Number(process.env.DEMO_DB_PORT ?? 54322);
const WEB_PORT = Number(process.env.DEMO_WEB_PORT ?? 3000);
const WITH_WEB = !process.argv.includes("--no-web");
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const PAYCHECK_USDC = 1_850_000_000n;
const TURNSTILE_SITE_KEY = "0x4AAAAAAFDQGy1MnmLBUS_3";

/** The verifiable CI build of main; `PROGRAM_SO` overrides it. The program is never built here. */
const RELEASE_SO = resolve(ROOT, "internal", "release", "e53fbfe", "paycheck_router.so");

process.env.PAYCHECK_ROUTER_KEYS_DIR = KEYS_DIR;
if (!process.env.PROGRAM_SO && existsSync(RELEASE_SO)) process.env.PROGRAM_SO = RELEASE_SO;

/** `solana-verify`'s executable hash: SHA-256 of the binary without its trailing zero padding. */
function verifiableHash(path: string): string {
  const bytes = readFileSync(path);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return createHash("sha256").update(bytes.subarray(0, end)).digest("hex");
}

const children: ChildProcess[] = [];
const cleanups: (() => Promise<void>)[] = [];

function step(message: string): void {
  console.log(`\n▸ ${message}`);
}

function explorer(kind: "tx" | "address", value: string, rpcUrl: string): string {
  const url = new URL(`https://explorer.solana.com/${kind}/${value}`);
  url.searchParams.set("cluster", "custom");
  url.searchParams.set("customUrl", rpcUrl);
  return url.toString();
}

/** Starts a child process and resolves once a line of its output matches `ready`. */
function launch(
  label: string,
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; ready: RegExp; timeoutMs: number },
): Promise<ChildProcess> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    const logDir = resolve(ROOT, ".demo");
    mkdirSync(logDir, { recursive: true });
    const logPath = resolve(logDir, `${label}.log`);
    writeFileSync(logPath, "");
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled)
        reject(new Error(`${label} was not ready after ${options.timeoutMs} ms; see ${logPath}`));
    }, options.timeoutMs);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      writeFileSync(logPath, text, { flag: "a" });
      if (!settled && options.ready.test(text)) {
        settled = true;
        clearTimeout(timer);
        resolvePromise(child);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`${label} exited with ${code}; see ${logPath}`));
      }
    });
  });
}

async function shutdown(code: number): Promise<never> {
  for (const child of children) child.kill("SIGTERM");
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch (error) {
      console.error("cleanup failed:", error);
    }
  }
  process.exit(code);
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolvePort(true)));
  });
}

/** The recording's ports are fixed; a busy one stops the run instead of moving it silently. */
async function assertPortsFree(): Promise<void> {
  const wanted: [string, number, string][] = [
    ["surfnet RPC", RPC_PORT, "DEMO_SURFNET_PORT"],
    ["surfnet WebSocket", RPC_PORT + 1, "DEMO_SURFNET_PORT (WebSocket is the port + 1)"],
    ["core", CORE_PORT, "DEMO_CORE_PORT"],
    ["database", DB_PORT, "DEMO_DB_PORT"],
  ];
  if (WITH_WEB) wanted.push(["web", WEB_PORT, "DEMO_WEB_PORT"]);
  const busy: string[] = [];
  for (const [label, port, variable] of wanted) {
    if (!(await portFree(port))) busy.push(`${label} ${port} (set ${variable} to move it)`);
  }
  if (busy.length > 0) {
    throw new Error(`ports in use: ${busy.join("; ")}`);
  }
}

async function main(): Promise<void> {
  await assertPortsFree();
  mkdirSync(resolve(ROOT, ".demo"), { recursive: true });
  step("Starting a fresh surfnet (Surfpool fork of mainnet)");
  const surfnet = await startSurfnet({
    rpcPort: RPC_PORT,
    wsPort: RPC_PORT + 1,
    logFile: resolve(ROOT, ".demo", "surfpool.log"),
  });
  cleanups.push(() => surfnet.stop());
  console.log(
    `  RPC ${surfnet.rpcUrl} · start slot ${surfnet.startSlot} · clock drift ${surfnet.clockDriftSecs}s`,
  );

  step("Funding the fork-only keys");
  const signers = await loadForkSigners();
  await fundForkKeys(surfnet, signers);

  step("Deploying paycheck_router under the production program ID");
  const program = await deployProgram(surfnet);
  console.log(`  ${program.programId}`);
  console.log(`  binary ${program.soPath}`);
  console.log(`  verifiable build hash ${verifiableHash(program.soPath)}`);

  step("Initializing Config, the registry and the protocol lookup table");
  const protocol = await initializeProtocol(surfnet, signers);
  console.log(`  Config ${protocol.config} · treasury ${protocol.treasury}`);

  step("Starting the demo database");
  const database = await startDemoDatabase({ repoRoot: ROOT, port: DB_PORT });
  cleanups.push(() => database.stop());
  console.log(`  Database: Postgres 17 (PGlite) with supabase/migrations at ${database.url}`);

  step("Writing apps/core/.dev.vars and apps/web/.env.local (both gitignored)");
  writeCoreDevVars({
    keysDir: KEYS_DIR,
    secretsDir: SECRETS_DIR,
    outPath: resolve(ROOT, "apps", "core", ".dev.vars"),
    surfnetRpcUrl: surfnet.rpcUrl,
    extra: {
      CONFIG_PDA: protocol.config,
      PROTOCOL_ALT: protocol.lookupTable.address,
      APP_ORIGIN: `http://localhost:${WEB_PORT}`,
      CORS_ORIGINS: WEB_URL,
      SIWS_DOMAIN: `localhost:${WEB_PORT},127.0.0.1:${WEB_PORT}`,
    },
    requirePyth: true,
  });
  const demoWorker = Uint8Array.from(
    JSON.parse(readFileSync(resolve(KEYS_DIR, "demo-worker.json"), "utf8")) as number[],
  );
  writeFileSync(
    resolve(ROOT, "apps", "web", ".env.local"),
    [
      "NEXT_PUBLIC_ENVIRONMENT=demo",
      `NEXT_PUBLIC_API_URL=http://127.0.0.1:${CORE_PORT}`,
      `NEXT_PUBLIC_SURFNET_RPC_URL=${surfnet.rpcUrl}`,
      `NEXT_PUBLIC_SITE_URL=${WEB_URL}`,
      "NEXT_PUBLIC_MAINNET_DEPLOYED=false",
      `NEXT_PUBLIC_TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY}`,
      `DEMO_SIGNER_SECRET=${getBase58Decoder().decode(demoWorker)}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  step("Starting core (wrangler dev --env demo)");
  // Durable Object, queue and KV state starts empty with each fresh surfnet.
  const coreState = resolve(ROOT, ".demo", "core-state");
  rmSync(coreState, { recursive: true, force: true });
  await launch(
    "core",
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--env",
      "demo",
      "--port",
      String(CORE_PORT),
      "--ip",
      "127.0.0.1",
      "--persist-to",
      coreState,
    ],
    {
      cwd: resolve(ROOT, "apps", "core"),
      env: { CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: database.url },
      ready: /Ready on/,
      timeoutMs: 120_000,
    },
  );
  const status = await fetch(`http://127.0.0.1:${CORE_PORT}/status`);
  if (!status.ok) throw new Error(`core /status answered ${status.status}`);

  if (WITH_WEB) {
    step("Starting web (next dev)");
    await launch(
      "web",
      "pnpm",
      [
        "--filter",
        "@paycheck-router/web",
        "exec",
        "next",
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(WEB_PORT),
      ],
      {
        cwd: ROOT,
        ready: /Ready in|Local:/,
        timeoutMs: 180_000,
      },
    );
  }

  const employer = signers["employer-1"];
  const worker = signers["demo-worker"];
  console.log(`
Demo is up (Mainnet fork (Surfpool) · no real funds)
  Web          ${WITH_WEB ? WEB_URL : "not started (--no-web)"}
  Core API     http://127.0.0.1:${CORE_PORT}  (status: http://127.0.0.1:${CORE_PORT}/status)
  Realtime     ws://127.0.0.1:${CORE_PORT}/realtime
  Proof        ${WEB_URL}/proof  ·  http://127.0.0.1:${CORE_PORT}/proof
  Surfnet RPC  ${surfnet.rpcUrl}  (ws ${surfnet.wsUrl})
  Program      ${explorer("address", program.programId, surfnet.rpcUrl)}
  Database     ${database.url}
  Logs         ${resolve(ROOT, ".demo")}
  Demo worker  ${worker.address}
  Employer     ${employer.address}

Press P to send a $1,850 USDC paycheck from employer-1 to the demo worker. Press Q to stop.`);

  emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  let sending = false;
  process.stdin.on("keypress", (_text, key: { name?: string; ctrl?: boolean }) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      console.log("\nStopping…");
      void shutdown(0);
      return;
    }
    if (key.name !== "p" || sending) return;
    sending = true;
    sendPaycheck(surfnet, { from: employer, to: worker.address, amount: PAYCHECK_USDC })
      .then(({ signature, slot }) => {
        console.log(
          `\nPaycheck sent: 1,850 USDC at slot ${slot}\n  ${explorer("tx", signature, surfnet.rpcUrl)}`,
        );
      })
      .catch((error: unknown) => console.error("\nPaycheck failed:", error))
      .finally(() => {
        sending = false;
      });
  });
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
main().catch(async (error: unknown) => {
  console.error("\ndemo:record failed:", error instanceof Error ? error.message : error);
  await shutdown(1);
});
