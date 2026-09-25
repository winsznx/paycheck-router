import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HOT_KEYS = {
  CRANK_KEY: "crank",
  RECORDER_KEY: "recorder",
  SPONSOR_KEY: "sponsor",
  ATTESTER_KEY: "attester",
  OPS_KEY: "ops",
} as const;

export type DevVarsOptions = {
  /** Directory with the fork-only `<name>.json` keypairs. */
  keysDir: string;
  /** Directory with provider secrets (`turnstile.json`, `pyth.env`). */
  secretsDir: string;
  /** Path of the gitignored `.dev.vars` to write. */
  outPath: string;
  surfnetRpcUrl: string;
  /** Run-specific variables, such as the Config PDA and protocol lookup table of this surfnet. */
  extra?: Record<string, string>;
  /** Fail when a secret the run depends on is missing instead of leaving it unset. */
  requirePyth: boolean;
};

function parseDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) values[match[1]] = match[2].replace(/^'(.*)'$/, "$1");
  }
  return values;
}

function readKeypair(keysDir: string, name: string): string {
  const path = resolve(keysDir, `${name}.json`);
  const bytes = JSON.parse(readFileSync(path, "utf8")) as number[];
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error(`${path} is not a keypair`);
  return JSON.stringify(bytes);
}

function sessionSigningKey(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: `local-${Date.now()}` });
}

function vapidPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  if (!jwk.d) throw new Error("VAPID key export failed");
  return jwk.d;
}

/**
 * Writes `apps/core/.dev.vars` for a surfnet run. Hot keys come from the fork-only keypairs;
 * generated secrets (session key, VAPID key, webhook secrets) are kept across runs so sessions
 * survive a restart.
 */
export function writeCoreDevVars(options: DevVarsOptions): Record<string, string> {
  const previous = parseDotEnv(options.outPath);
  const vars: Record<string, string> = {};
  for (const [name, file] of Object.entries(HOT_KEYS)) {
    vars[name] = readKeypair(options.keysDir, file);
  }
  vars.SESSION_SIGNING_KEY = previous.SESSION_SIGNING_KEY ?? sessionSigningKey();
  vars.VAPID_PRIVATE_KEY = previous.VAPID_PRIVATE_KEY ?? vapidPrivateKey();
  vars.HELIUS_WEBHOOK_SECRET =
    previous.HELIUS_WEBHOOK_SECRET ?? randomBytes(32).toString("base64url");
  vars.TELEGRAM_WEBHOOK_SECRET =
    previous.TELEGRAM_WEBHOOK_SECRET ?? randomBytes(32).toString("base64url");
  vars.PARTNER_WEBHOOK_SIGNING_KEY =
    previous.PARTNER_WEBHOOK_SIGNING_KEY ?? randomBytes(32).toString("base64url");

  const turnstilePath = resolve(options.secretsDir, "turnstile.json");
  if (existsSync(turnstilePath)) {
    const turnstile = JSON.parse(readFileSync(turnstilePath, "utf8")) as {
      result?: { secret?: string };
    };
    if (turnstile.result?.secret) vars.TURNSTILE_SECRET = turnstile.result.secret;
  }

  const pyth = parseDotEnv(resolve(options.secretsDir, "pyth.env"));
  if (pyth.HERMES_URL) vars.HERMES_URL = pyth.HERMES_URL;
  if (pyth.PYTH_API_KEY) vars.PYTH_API_KEY = pyth.PYTH_API_KEY;
  else if (options.requirePyth) {
    throw new Error(
      `PYTH_API_KEY missing: put PYTH_API_KEY=... in ${resolve(options.secretsDir, "pyth.env")}`,
    );
  }

  for (const name of ["JUPITER_API_KEY", "HELIUS_API_KEY"] as const) {
    const value = process.env[name] ?? previous[name];
    if (value) vars[name] = value;
  }

  vars.ENVIRONMENT = "demo";
  vars.SURFNET_RPC_URL = options.surfnetRpcUrl;
  Object.assign(vars, options.extra ?? {});

  const body = Object.entries(vars)
    .map(([name, value]) => `${name}='${value}'`)
    .join("\n");
  writeFileSync(options.outPath, `${body}\n`, { mode: 0o600 });
  return vars;
}
