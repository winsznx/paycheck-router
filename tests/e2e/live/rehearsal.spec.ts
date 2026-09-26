import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { api } from "@paycheck-router/shared";
import { expect, type Page, test } from "@playwright/test";

/**
 * Live rehearsal against a running `pnpm demo:record` stack: a real surfnet, core and web, no
 * fixtures. It onboards with the in-app demo signer, sends the paycheck through demo:record's
 * stdin, waits for the slices to settle and saves what the UI rendered, the API responses behind
 * it and screenshots to evidence/rehearsal/<run-id>/.
 *
 * DEMO_RECORD_INPUT must name the FIFO feeding demo:record's stdin (`printf p` sends the paycheck).
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const API_URL = (process.env.E2E_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const API_ORIGIN = new URL(API_URL).origin;
const TRIGGER = process.env.DEMO_RECORD_INPUT;
const RUN_ID = process.env.E2E_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
const OUT = path.join(REPO_ROOT, "evidence", "rehearsal", RUN_ID);
const API_DIR = path.join(OUT, "api");
const FIND_PAYCHECK_TIMEOUT_MS = 4 * 60_000;
const SETTLE_TIMEOUT_MS = 8 * 60_000;
const POLL_MS = 10_000;

/** Statuses after which a leg changes only through a new attempt, a buy-now or expiry. */
const UNSETTLED = new Set<api.LegStatus>(["pending", "executing", "executed"]);

type Run = {
  runId: string;
  baseURL: string;
  apiUrl: string;
  startedAt: string;
  onboardedAt?: string;
  paycheckTriggeredAt?: string;
  paycheckId?: string;
  settledAt?: string;
  settled: boolean;
  legs?: Array<{
    symbol: string;
    status: api.LegStatus;
    waitReason: string | null;
    premiumBps: number | null;
    amountIn: string;
    outAmount: string | null;
    executedSig: string | null;
  }>;
  proof?: { environment: string; fork: boolean; programId: string };
  session?: {
    keptAcrossReload: boolean;
    signedOut: boolean;
    refreshCallsAfterSignOut: number;
    signedBackIn: boolean;
  };
  screenshots: string[];
  apiResponses: string;
  demoRecordLogs: string;
  bundle: string | null;
  notes: string[];
  consoleErrors: string[];
  apiErrors: Array<{ at: string; path: string; status: number; body: unknown }>;
  failure?: string;
  finishedAt?: string;
};

function recordApiResponses(page: Page): void {
  let seq = 0;
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.origin !== API_ORIGIN) return;
    const method = response.request().method();
    // Sessions and the socket carry tokens; they never go into evidence.
    if (method === "OPTIONS" || url.pathname.startsWith("/auth") || url.pathname === "/realtime")
      return;
    const text = await response.text().catch(() => null);
    if (text === null) return;
    seq += 1;
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    const name = `${String(seq).padStart(3, "0")}-${method}${url.pathname.replace(/[^A-Za-z0-9-]+/g, "_")}.json`;
    writeFileSync(
      path.join(API_DIR, name),
      `${JSON.stringify({ method, path: url.pathname + url.search, status: response.status(), body }, null, 2)}\n`,
    );
  });
}

async function shoot(page: Page, run: Run, name: string, fullPage: boolean): Promise<void> {
  const file = `${name}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage, animations: "disabled" });
  run.screenshots.push(file);
}

/**
 * The session in the running stack: a reload keeps it, signing out ends it for this browser (no
 * refresh call afterwards), and the same wallet signs back in to the same router.
 */
async function auditSession(page: Page, run: Run): Promise<void> {
  const audit = {
    keptAcrossReload: false,
    signedOut: false,
    refreshCallsAfterSignOut: 0,
    signedBackIn: false,
  };
  run.session = audit;
  const router = page.getByRole("heading", { name: "Your router" });

  await page.goto("/app");
  await page.reload();
  await expect(router).toBeVisible();
  audit.keptAcrossReload = true;

  await page.goto("/app/settings/security");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  audit.signedOut = true;

  const countRefresh = (request: { url: () => string }) => {
    if (request.url().includes("/api/session/refresh")) audit.refreshCallsAfterSignOut += 1;
  };
  page.on("request", countRefresh);
  await page.goto("/app");
  await page.waitForURL(/\/app\/onboarding\/welcome$/);
  page.off("request", countRefresh);
  expect(audit.refreshCallsAfterSignOut, "a signed-out browser asks for no session").toBe(0);

  await page.goto("/app/onboarding/sign-in");
  await page.getByRole("button", { name: "Continue with Paycheck Router demo signer" }).click();
  await page.waitForURL(/\/app\/onboarding\/eligibility$/);
  await page.goto("/app");
  await expect(router).toBeVisible();
  audit.signedBackIn = true;
}

async function onboard(page: Page, capture: (name: string) => Promise<void>): Promise<void> {
  await page.goto("/app/onboarding/welcome");
  await expect(page.getByTestId("fork-banner")).toBeVisible();
  await page.getByRole("link", { name: "Get started" }).click();

  await page.waitForURL(/\/app\/onboarding\/sign-in$/);
  await page.getByRole("button", { name: "Continue with Paycheck Router demo signer" }).click();

  await page.waitForURL(/\/app\/onboarding\/eligibility$/);
  await page.getByLabel("Country you live in").selectOption("NG");
  await page.getByLabel("I am not a US person").check();
  await page.getByLabel("I accept the terms and the risk disclosure").check();
  await page.getByRole("button", { name: "Continue" }).click();
  const confirm = page.getByRole("button", { name: "Confirm and continue" });
  const walletHeading = page.getByRole("heading", { name: "Where does your pay land?" });
  const blocked = page.getByRole("heading", { name: "Paycheck Router isn't available to you" });
  await expect(walletHeading.or(confirm).or(blocked)).toBeVisible();
  await expect(blocked).toBeHidden();
  if (await confirm.isVisible()) await confirm.click();

  await page.waitForURL(/\/app\/onboarding\/wallet$/);
  await page.getByRole("button", { name: "This is my pay wallet" }).click();

  await page.waitForURL(/\/app\/onboarding\/pay-history$/);
  await page.getByLabel("Typical paycheck").fill("1850");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL(/\/app\/onboarding\/split$/);
  await expect(page.getByRole("slider", { name: "Invest from each paycheck" })).toHaveAttribute(
    "aria-valuenow",
    "20",
  );
  // "Pre-IPO spice" (SPYx 60, NVDAx 20, Anthropic 10, OpenAI 10) is the preset closest to PRD 27.3.
  await page.getByRole("button", { name: "Pre-IPO spice" }).click();
  await expect(page.locator(".asset-option").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".preview-row").first()).toBeVisible({ timeout: 30_000 });
  await capture("onboarding-split");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL(/\/app\/onboarding\/allowance$/);
  await expect(page.getByLabel("3 paychecks")).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL(/\/app\/onboarding\/review$/);
  const passed = page.getByText("Simulation passed", { exact: true });
  const failed = page.getByText("Simulation failed", { exact: true });
  await expect(passed.or(failed)).toBeVisible({ timeout: 120_000 });
  await expect(failed, "the setup transaction failed simulation").toBeHidden();
  await capture("onboarding-review");
  await page.getByRole("button", { name: "Sign and go live" }).click();
  await page.waitForURL(/\/app\/onboarding\/done$/, { timeout: 180_000 });
  await expect(page.getByRole("heading", { name: "You're live." })).toBeVisible();
}

async function findLatestPaycheck(page: Page): Promise<string> {
  const deadline = Date.now() + FIND_PAYCHECK_TIMEOUT_MS;
  const card = page.locator('a[href^="/app/paychecks/"]').first();
  while (Date.now() < deadline) {
    await page.goto("/app/paychecks");
    await expect(page.getByRole("heading", { name: "Paychecks", level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    if (await card.isVisible()) {
      const href = await card.getAttribute("href");
      const id = href?.split("/").pop();
      if (id) return id;
    }
    await page.waitForTimeout(POLL_MS / 2);
  }
  throw new Error(`No paycheck appeared within ${FIND_PAYCHECK_TIMEOUT_MS / 1000} s of sending it`);
}

/** Loads the detail page; a failed API read is recorded and returns null so the poll retries. */
async function loadDetail(page: Page, id: string, run: Run): Promise<api.PaycheckDetail | null> {
  const response = page.waitForResponse(
    (r) => r.url() === `${API_URL}/paychecks/${id}` && r.request().method() === "GET",
  );
  await page.goto(`/app/paychecks/${id}`);
  const result = await response;
  const body: unknown = await result.json().catch(() => null);
  const parsed = api.PaycheckDetail.safeParse(body);
  if (parsed.success) return parsed.data;
  run.apiErrors.push({
    at: new Date().toISOString(),
    path: `/paychecks/${id}`,
    status: result.status(),
    body,
  });
  return null;
}

/** LANDING waits retry at once with a fresh quote, so they are still in flight. */
const inFlight = (leg: api.Leg) =>
  UNSETTLED.has(leg.status) || (leg.status === "waiting" && leg.waitReason === "LANDING");

const isSettled = (detail: api.PaycheckDetail | null): detail is api.PaycheckDetail =>
  detail !== null && !detail.legs.some(inFlight);

test("rehearsal: onboard, send a paycheck, watch it settle", async ({ page, baseURL }) => {
  test.skip(!TRIGGER, "DEMO_RECORD_INPUT must name the FIFO feeding pnpm demo:record's stdin");
  mkdirSync(API_DIR, { recursive: true });
  const run: Run = {
    runId: RUN_ID,
    baseURL: baseURL ?? "",
    apiUrl: API_URL,
    startedAt: new Date().toISOString(),
    settled: false,
    screenshots: [],
    apiResponses: path.relative(REPO_ROOT, API_DIR),
    demoRecordLogs: ".demo/ in the checkout that ran pnpm demo:record",
    bundle: null,
    notes: [
      "pnpm demo:record writes no evidence bundle; its surfpool, core and web logs are in .demo/.",
      "Session, auth and realtime traffic is not recorded because it carries tokens.",
    ],
    consoleErrors: [],
    apiErrors: [],
  };
  recordApiResponses(page);
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Hydration reports put the differing props on +/- lines deep in a long message.
    const diff = text
      .split("\n")
      .filter((line) => /^\s*[+-]\s+\S/.test(line) && !/^\s*-\s[A-Z]/.test(line))
      .slice(0, 8)
      .join("\n");
    run.consoleErrors.push(`${page.url()}: ${text.slice(0, 200)}${diff ? `\n${diff}` : ""}`);
  });
  page.on("pageerror", (error) => run.consoleErrors.push(`pageerror: ${error.message}`));

  let detail: api.PaycheckDetail | undefined;
  try {
    await onboard(page, (name) => shoot(page, run, name, true));
    run.onboardedAt = new Date().toISOString();
    await shoot(page, run, "onboarding-done", true);

    writeFileSync(TRIGGER as string, "p", { flag: "a" });
    run.paycheckTriggeredAt = new Date().toISOString();

    const id = await findLatestPaycheck(page);
    run.paycheckId = id;
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    let latest = await loadDetail(page, id, run);
    while (!isSettled(latest) && Date.now() < deadline) {
      await page.waitForTimeout(POLL_MS);
      latest = (await loadDetail(page, id, run)) ?? latest;
    }
    if (!latest) throw new Error(`GET /paychecks/${id} never returned a paycheck; see apiErrors`);
    detail = latest;
    run.settled = isSettled(detail);
    if (run.settled) run.settledAt = new Date().toISOString();
    run.legs = detail.legs.map((leg) => ({
      symbol: leg.symbol,
      status: leg.status,
      waitReason: leg.waitReason,
      premiumBps: leg.premiumBps,
      amountIn: leg.amountIn,
      outAmount: leg.outAmount,
      executedSig: leg.executedSig,
    }));

    // Paycheck detail with the fork banner in view, then the full page.
    await expect(page.getByTestId("fork-banner")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Employer (demo)");
    await shoot(page, run, "paycheck-detail", false);
    await shoot(page, run, "paycheck-detail-full", true);

    // The UI shows what the API returned for every slice, and no raw message keys.
    const fourDecimals = new Intl.NumberFormat("en", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
    for (const leg of detail.legs) {
      const row = page.locator("li.pr-slice").filter({ hasText: leg.symbol }).first();
      await expect(row.locator("[data-status]").first()).toHaveAttribute("data-status", leg.status);
      // Bought slices show the wallet's Scaled UI amount (sharesUi), not the raw amount.
      if (leg.sharesUi) {
        await expect
          .soft(row, `${leg.symbol} shows sharesUi`)
          .toContainText(`${fourDecimals.format(Number(leg.sharesUi))} ${leg.symbol}`);
      }
    }
    await expect(page.locator("body")).not.toContainText("app.slice.");

    const anthropic = page.locator("li.pr-slice").filter({ hasText: "Anthropic" }).first();
    await anthropic.getByRole("button", { name: "Proof" }).click();
    await expect(page.getByRole("dialog", { name: "Proof for Anthropic" })).toBeVisible();
    await shoot(page, run, "proof-sheet-anthropic", false);
    await page.keyboard.press("Escape");

    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Latest paycheck" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await shoot(page, run, "home", true);

    const proofResponse = page.waitForResponse((r) => r.url() === `${API_URL}/proof`, {
      timeout: 20_000,
    });
    await page.goto("/proof");
    await expect(page.getByRole("heading", { name: "Proof", level: 1 })).toBeVisible();
    await shoot(page, run, "proof", true);

    // The same run on a desktop viewport, for review.
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const [name, path] of [
      ["paycheck-detail-desktop", `/app/paychecks/${id}`],
      ["home-desktop", "/app"],
      ["portfolio-desktop", "/app/portfolio"],
      ["activity-desktop", "/app/activity"],
      ["landing-desktop", "/"],
      ["proof-desktop", "/proof"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState("load");
      await shoot(page, run, name, true);
    }
    await auditSession(page, run);
    const proof = await proofResponse.then((r) => r.json()).catch(() => null);
    const parsed = api.ProofResponse.safeParse(proof);
    if (parsed.success) {
      run.proof = {
        environment: parsed.data.environment,
        fork: parsed.data.fork,
        programId: parsed.data.programId,
      };
    } else {
      run.notes.push(
        "/proof is rendered server-side; its API response was not observed by the browser.",
      );
    }
  } catch (error) {
    run.failure = error instanceof Error ? error.message.slice(0, 2000) : String(error);
    await shoot(page, run, "failure", false).catch(() => undefined);
    throw error;
  } finally {
    run.finishedAt = new Date().toISOString();
    writeFileSync(path.join(OUT, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  }

  // Outcomes come from the chain; these are the expectations for the recording.
  expect(run.settled, "every slice reached a settled state").toBe(true);
  const byName = (symbol: string) => detail?.legs.find((leg) => leg.symbol === symbol);
  expect.soft(byName("Anthropic")?.status, "Anthropic slice").toBe("verified");
  expect.soft(byName("OpenAI")?.status, "OpenAI slice").toBe("waiting");
  expect.soft(byName("OpenAI")?.waitReason, "OpenAI wait reason").toBe("PREMIUM_TOO_HIGH");
});
