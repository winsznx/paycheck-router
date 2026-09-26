import { generateKeyPairSync } from "node:crypto";
import { api } from "@paycheck-router/shared";
import { type Address, address, generateKeyPairSigner, type KeyPairSigner } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { usdcAtaFor } from "../../../src/chain/accounts.ts";
import { createChainClient } from "../../../src/chain/client.ts";
import { chainEndpoints } from "../../../src/config.ts";
import type { Db } from "../../../src/db/client.ts";
import { demoFundings, demoPaychecks, routers } from "../../../src/db/schema.ts";
import type { ForkView } from "../../../src/demo/fork-state.ts";
import type { Env } from "../../../src/env.ts";
import { createTestDb, testApp, testEnv } from "../helpers/app.ts";
import { FakeFork, wireSignature } from "../helpers/fork.ts";
import { bearer, sessionFor } from "../helpers/session.ts";

const FORK = "https://fork.test";
const KEY = "vitest-surfnet-key";
const EPOCH = { id: "ab".repeat(16), startedAt: Date.parse("2026-09-26T12:00:00Z") };
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BLOCKHASH = "11111111111111111111111111111111";

/** A 64-byte Ed25519 secret key as a JSON byte array, the shape `hotSigner` reads. */
function secretKeyJson(): string {
  const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  const bytes = [
    ...Buffer.from(jwk.d ?? "", "base64url"),
    ...Buffer.from(jwk.x ?? "", "base64url"),
  ];
  return JSON.stringify(bytes);
}

/** InflowWatcher namespace double: every stub answers `forkView` with `view`. */
function watcherNamespace(view: () => ForkView): Env["INFLOW_WATCHER"] {
  return {
    idFromName: () => "global",
    get: () => ({ forkView: async () => view() }),
  } as unknown as Env["INFLOW_WATCHER"];
}

/** Balances the fake fork holds: lamports per account, USDC per token account address. */
function forkState(env: Env, fork: FakeFork) {
  const lamports = new Map<string, number>();
  const usdc = new Map<string, number>();
  fork
    .on("getMultipleAccounts", ([keys]) => ({
      context: { slot: 1 },
      value: (keys as string[]).map((key) => {
        if (usdc.has(key)) {
          return {
            data: {
              parsed: { info: { tokenAmount: { amount: String(usdc.get(key)) } }, type: "account" },
              program: "spl-token",
              space: 165,
            },
            executable: false,
            lamports: 2_039_280,
            owner: TOKEN_PROGRAM,
            rentEpoch: 0,
            space: 165,
          };
        }
        if (lamports.has(key)) {
          return {
            data: ["", "base64"],
            executable: false,
            lamports: lamports.get(key),
            owner: "11111111111111111111111111111111",
            rentEpoch: 0,
            space: 0,
          };
        }
        return null;
      }),
    }))
    .on("surfnet_setAccount", ([key, update]) => {
      lamports.set(key as string, (update as { lamports: number }).lamports);
      return null;
    })
    .on("surfnet_setTokenAccount", async ([owner, , update]) => {
      const ata = await usdcAtaFor(env, address(owner as string));
      usdc.set(ata, (update as { amount: number }).amount);
      return null;
    })
    .on("getLatestBlockhash", () => ({
      context: { slot: 1 },
      value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1_000 },
    }))
    .on("sendTransaction", ([wire]) => wireSignature(wire as string))
    .on("getSignatureStatuses", () => ({
      context: { slot: 78 },
      value: [
        {
          slot: 77,
          confirmations: 0,
          err: null,
          confirmationStatus: "confirmed",
          status: { Ok: null },
        },
      ],
    }));
  return { lamports, usdc };
}

describe("fork demo routes", () => {
  let db: Db;
  let fork: FakeFork;
  let view: ForkView;
  const env = testEnv({
    SURFNET_RPC_URL: FORK,
    SURFNET_RPC_KEY: KEY,
    RESET_EVERY_HOURS: "6",
    EMPLOYER_KEY: secretKeyJson(),
    DEMO_LIMITER: { limit: async () => ({ success: true }) } as unknown as RateLimit,
    INFLOW_WATCHER: watcherNamespace(() => view),
  });
  let app: ReturnType<typeof testApp>;

  beforeAll(async () => {
    ({ db } = await createTestDb());
    app = testApp(db, createChainClient(chainEndpoints(env)));
  });
  beforeEach(() => {
    view = { epoch: EPOCH, reachable: true };
    fork = new FakeFork(FORK);
    vi.stubGlobal("fetch", fork.fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const post = (path: string, session: api.SessionResponse | null, body?: unknown) =>
    app.request(
      path,
      {
        method: "POST",
        headers: { ...(session ? bearer(session) : {}), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );

  async function signedIn(): Promise<{ owner: KeyPairSigner; session: api.SessionResponse }> {
    const owner = await generateKeyPairSigner();
    return { owner, session: await sessionFor(app, env, owner) };
  }

  async function withRouter(owner: Address) {
    const [router] = await db
      .insert(routers)
      .values({
        owner,
        routerPda: owner.slice(0, 40).padEnd(44, "R"),
        authorityPda: owner.slice(0, 40).padEnd(44, "A"),
        payInAta: await usdcAtaFor(env, owner),
        investBps: 2000,
        minInflow: 20_000_000n,
        dailyCap: 5_000_000_000n,
        maxWaitSecs: 259_200,
        autoConvert: true,
        recorder: "EGaHpAB9Svfv6zW8ZcNrSEayvMPNsg1gJqQUPDYfNKqL",
      })
      .returning();
    if (!router) throw new Error("router insert failed");
    return router;
  }

  it("does not exist outside fork environments", async () => {
    const res = await app.request("/demo/status", {}, { ...env, SURFNET_RPC_URL: "" });
    expect(res.status).toBe(404);
  });

  it("reports the fork state and its reset schedule", async () => {
    const up = await app.request("/demo/status", {}, env);
    expect(api.DemoStatus.parse(await up.json())).toEqual({
      state: "up",
      lastResetAt: "2026-09-26T12:00:00.000Z",
      resetsAt: "2026-09-26T18:00:00.000Z",
    });
    view = { epoch: EPOCH, reachable: false };
    const down = api.DemoStatus.parse(await (await app.request("/demo/status", {}, env)).json());
    expect(down.state).toBe("down");
  });

  it("funds a wallet once per fork by cheatcode, with the fork key on every call", async () => {
    forkState(env, fork);
    const { owner, session } = await signedIn();
    const res = await post("/demo/fund", session);
    expect(res.status).toBe(200);
    expect(api.DemoFundResponse.parse(await res.json())).toEqual({
      wallet: owner.address,
      lamports: "50000000",
      usdc: "5000000000",
      signatures: [],
    });
    expect(fork.called("surfnet_setAccount")[0]?.params).toEqual([
      owner.address,
      { lamports: 50_000_000 },
    ]);
    expect(fork.called("surfnet_setTokenAccount")[0]?.params).toEqual([
      owner.address,
      env.USDC_MINT,
      { amount: 5_000_000_000, state: "initialized" },
      TOKEN_PROGRAM,
    ]);
    expect(fork.calls.every((call) => call.key === KEY)).toBe(true);

    const again = await post("/demo/fund", session);
    expect(again.status).toBe(409);
    expect(
      await db.select().from(demoFundings).where(eq(demoFundings.wallet, owner.address)),
    ).toHaveLength(1);
  });

  it("refuses to fund while the fork is resetting", async () => {
    view = { epoch: EPOCH, reachable: false };
    const { session } = await signedIn();
    const res = await post("/demo/fund", session);
    expect(res.status).toBe(503);
    expect(((await res.json()) as api.Problem).code).toBe("upstream_unavailable");
  });

  it("asks for a router before sending a paycheck", async () => {
    forkState(env, fork);
    const { session } = await signedIn();
    const res = await post("/demo/paycheck", session, { amountUsdc: "1850000000" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as api.Problem).code).toBe("conflict");
  });

  it("rejects amounts outside 20 to 5,000 USDC", async () => {
    const { session } = await signedIn();
    expect((await post("/demo/paycheck", session, { amountUsdc: "19999999" })).status).toBe(400);
    expect((await post("/demo/paycheck", session, { amountUsdc: "5000000001" })).status).toBe(400);
  });

  it("pays the router from employer-1 and limits each wallet to 3 per 10 minutes", async () => {
    forkState(env, fork);
    const { owner, session } = await signedIn();
    await withRouter(owner.address);

    const res = await post("/demo/paycheck", session, { amountUsdc: "1850000000" });
    expect(res.status).toBe(200);
    const paid = api.DemoPaycheckResponse.parse(await res.json());
    const sent = fork.called("sendTransaction")[0];
    expect(paid).toEqual({
      signature: wireSignature(sent?.params[0] as string),
      amountUsdc: "1850000000",
      slot: "77",
    });
    expect(sent?.key).toBe(KEY);
    const [row] = await db
      .select()
      .from(demoPaychecks)
      .where(eq(demoPaychecks.signature, paid.signature));
    expect(row).toMatchObject({ wallet: owner.address, epoch: EPOCH.id, amount: 1_850_000_000n });

    // The fake fork keeps one blockhash, so an identical amount is the identical transaction.
    const duplicate = await post("/demo/paycheck", session, { amountUsdc: "1850000000" });
    expect(duplicate.status).toBe(409);
    expect((await post("/demo/paycheck", session, { amountUsdc: "20000000" })).status).toBe(200);
    expect((await post("/demo/paycheck", session, { amountUsdc: "20000001" })).status).toBe(200);
    const limited = await post("/demo/paycheck", session, { amountUsdc: "20000002" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("frees the limit slot when the paycheck fails onchain", async () => {
    forkState(env, fork);
    fork.on("getSignatureStatuses", () => ({
      context: { slot: 78 },
      value: [{ slot: 77, confirmations: 0, err: { InstructionError: [0, "Custom"] } }],
    }));
    const { owner, session } = await signedIn();
    await withRouter(owner.address);
    const res = await post("/demo/paycheck", session, { amountUsdc: "20000000" });
    expect(res.status).toBe(502);
    expect(
      await db.select().from(demoPaychecks).where(eq(demoPaychecks.wallet, owner.address)),
    ).toHaveLength(0);
  });

  it("simulates a transaction on the fork and reports its logs", async () => {
    fork.on("simulateTransaction", ([, options]) => {
      expect(options).toMatchObject({ encoding: "base64", sigVerify: false });
      return {
        context: { slot: 1 },
        value: { err: null, logs: ["Program log: ok"], unitsConsumed: 4_321, accounts: null },
      };
    });
    const { session } = await signedIn();
    const res = await post("/demo/simulate", session, { transaction: "AQID" });
    expect(api.DemoSimulateResponse.parse(await res.json())).toEqual({
      ok: true,
      unitsConsumed: 4_321,
      logs: ["Program log: ok"],
      error: null,
    });
    expect(fork.called("simulateTransaction")[0]?.key).toBe(KEY);
  });

  it("returns the fork's refusal as a failed simulation", async () => {
    fork.on("simulateTransaction", () => {
      throw new Error("failed to deserialize transaction");
    });
    const { session } = await signedIn();
    const res = await post("/demo/simulate", session, { transaction: "AQID" });
    const body = api.DemoSimulateResponse.parse(await res.json());
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/failed to deserialize/);
  });

  it("requires a session for the wallet routes", async () => {
    expect((await post("/demo/fund", null)).status).toBe(401);
    expect((await post("/demo/simulate", null, { transaction: "AQID" })).status).toBe(401);
  });
});
