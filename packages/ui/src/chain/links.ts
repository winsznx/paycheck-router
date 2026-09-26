/**
 * Where a chain value links, by what it is and where the page runs.
 *
 * - `fork-live`: a demo or local run; the surfnet RPC is reachable, so Solana Explorer reads it
 *   through `cluster=custom`.
 * - `fork-recorded`: the public site before the mainnet deploy; fork objects exist only in the
 *   recorded bundle, so they link to the proof page and the recorded JSON on GitHub, never to a
 *   mainnet explorer.
 * - `fork-app`: the hosted demo; its fork RPC is private, so no explorer can read it. Slice
 *   executions link to the app's own proof view; other fork values are copy-only.
 * - `mainnet`: everything links to Solana Explorer.
 *
 * Real mainnet objects (xStocks, PreStocks and USDC mints, Jupiter, the Pyth receiver) always
 * link to mainnet Explorer; our own program links to its verifiable build until it is deployed.
 */
export type ChainMode = "fork-live" | "fork-recorded" | "fork-app" | "mainnet";

/** `slice` is a slice execution's signature, which has a proof view; `tx` is any other. */
export type ChainKind = "tx" | "slice" | "account" | "mint" | "program" | "own-program" | "feed";

export type ChainEnv = {
  mode: ChainMode;
  surfnetRpcUrl: string;
  /** e.g. https://github.com/winsznx/paycheck-router */
  repoUrl: string;
  /** Repository path of the recorded fork bundle, e.g. evidence/stocklana-fork */
  evidencePath: string;
};

export type ChainLinkRole = "explorer" | "proof" | "recorded" | "pyth" | "build";

export type ChainLink = { href: string; role: ChainLinkRole; external: boolean };

const EXPLORER = "https://explorer.solana.com";

function explorer(path: "tx" | "address", value: string, env: ChainEnv, fork: boolean): ChainLink {
  const url = new URL(`${EXPLORER}/${path}/${value}`);
  if (fork) {
    url.searchParams.set("cluster", "custom");
    url.searchParams.set("customUrl", env.surfnetRpcUrl);
  }
  return { href: url.toString(), role: "explorer", external: true };
}

const repoFile = (env: ChainEnv, file: string): string =>
  `${env.repoUrl.replace(/\/$/, "")}/blob/main/${env.evidencePath}/${file}`;

/** Pyth Insights page for a feed symbol such as `Equity.US.SPY/USD`. */
export function pythFeedUrl(symbol: string): string {
  return `https://insights.pyth.network/price-feeds/${encodeURIComponent(symbol)}`;
}

/** The links for a chain value, primary first. An empty list means copy-only. */
export function chainLinks(
  kind: ChainKind,
  value: string,
  env: ChainEnv,
  feedSymbol?: string | null,
): ChainLink[] {
  switch (kind) {
    case "mint":
    case "program":
      return [explorer("address", value, env, false)];
    case "feed":
      return feedSymbol ? [{ href: pythFeedUrl(feedSymbol), role: "pyth", external: true }] : [];
    case "own-program":
      return env.mode === "mainnet"
        ? [explorer("address", value, env, false)]
        : [{ href: `${env.repoUrl.replace(/\/$/, "")}/releases`, role: "build", external: true }];
    case "slice":
      if (env.mode === "fork-app")
        return [{ href: `/proof/${value}`, role: "proof", external: false }];
      return chainLinks("tx", value, env);
    case "tx":
      if (env.mode === "fork-app") return [];
      if (env.mode === "fork-live") return [explorer("tx", value, env, true)];
      if (env.mode === "mainnet") return [explorer("tx", value, env, false)];
      return [
        { href: `/proof/${value}`, role: "proof", external: false },
        { href: repoFile(env, `raw/tx/${value}.json`), role: "recorded", external: true },
      ];
    case "account":
      if (env.mode === "fork-app") return [];
      if (env.mode === "fork-live") return [explorer("address", value, env, true)];
      if (env.mode === "mainnet") return [explorer("address", value, env, false)];
      return [{ href: repoFile(env, "manifest.json"), role: "recorded", external: true }];
  }
}
