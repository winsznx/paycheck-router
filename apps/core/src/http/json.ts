import type { AppContext } from "./context.ts";
import { badRequest } from "./problem.ts";

export async function readJson(c: AppContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw badRequest("Body must be valid JSON");
  }
}
