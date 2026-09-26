import { describe, expect, it } from "vitest";
import { baseName } from "../../../src/queues/index.ts";

describe("queue base names", () => {
  it("maps every environment's queues to the same handler", () => {
    for (const name of ["inflows", "staging-inflows", "demo-inflows"]) {
      expect(baseName(name)).toBe("inflows");
    }
    expect(baseName("demo-executions")).toBe("executions");
    expect(baseName("demo-verify-dlq")).toBe("verify-dlq");
  });

  it("covers every queue a wrangler environment consumes", async () => {
    const { readFileSync } = await import("node:fs");
    const config = readFileSync(new URL("../../../wrangler.jsonc", import.meta.url), "utf8");
    const consumed = [...config.matchAll(/"queue":\s*"([a-z-]+)"/g)].map((match) => match[1] ?? "");
    const handled = new Set(["inflows", "executions", "verify", "notify"]);
    for (const queue of consumed) {
      const base = baseName(queue);
      expect(handled.has(base) || base.endsWith("-dlq"), queue).toBe(true);
    }
  });
});
