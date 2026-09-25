import type { api } from "@paycheck-router/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

type ProblemCode = api.ProblemCode;
type FieldError = { path: string; message: string };

const TITLES: Record<ProblemCode, string> = {
  bad_request: "Bad request",
  validation_failed: "Validation failed",
  unauthorized: "Unauthorized",
  forbidden: "Forbidden",
  not_found: "Not found",
  conflict: "Conflict",
  idempotency_conflict: "Idempotency key reused with a different request",
  rate_limited: "Too many requests",
  ineligible: "Not eligible",
  chain_error: "Chain request failed",
  upstream_unavailable: "Upstream unavailable",
  not_configured: "Not configured",
  internal: "Internal error",
};

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ProblemCode,
    message: string,
    readonly errors?: FieldError[],
  ) {
    super(message);
    this.name = "ApiError";
  }

  toProblem(requestId: string): api.Problem {
    return {
      type: `/problems/${this.code}`,
      title: TITLES[this.code],
      status: this.status,
      detail: this.message,
      code: this.code,
      requestId,
      ...(this.errors ? { errors: this.errors } : {}),
    };
  }
}

export const badRequest = (detail: string) => new ApiError(400, "bad_request", detail);
export const unauthorized = (detail = "Sign in first") => new ApiError(401, "unauthorized", detail);
export const forbidden = (detail: string) => new ApiError(403, "forbidden", detail);
export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);
export const conflict = (detail: string) => new ApiError(409, "conflict", detail);
export const notConfigured = (what: string) =>
  new ApiError(503, "not_configured", `${what} is not configured in this environment`);
export const upstreamUnavailable = (what: string, detail: string) =>
  new ApiError(502, "upstream_unavailable", `${what}: ${detail}`);

export function problemResponse(error: ApiError, requestId: string): Response {
  return new Response(JSON.stringify(error.toProblem(requestId)), {
    status: error.status,
    headers: { "content-type": "application/problem+json" },
  });
}

/** Parses `value` or throws a 400 listing every field that failed. */
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ApiError(
    400,
    "validation_failed",
    "The request did not match the schema",
    result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  );
}
