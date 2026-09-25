"use client";

import type { z } from "zod";
import { apiUrl } from "@/lib/env.ts";
import { accessToken, refreshSession } from "@/lib/session.ts";
import { ApiProblem } from "./problem.ts";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** POSTs carry an Idempotency-Key (PRD 11.1); pass one to make a retry safe. */
  idempotencyKey?: string;
  signal?: AbortSignal;
};

async function send(
  path: string,
  options: RequestOptions,
  token: string | null,
): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.method && options.method !== "GET") {
    headers.set("idempotency-key", options.idempotencyKey ?? crypto.randomUUID());
  }
  try {
    return await fetch(`${apiUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? null : JSON.stringify(options.body),
      signal: options.signal ?? null,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiProblem(0, "offline", "The Paycheck Router API could not be reached");
  }
}

/** Authenticated JSON request validated against a shared Zod schema. */
export async function apiRequest<S extends z.ZodType>(
  path: string,
  schema: S,
  options: RequestOptions = {},
): Promise<z.infer<S>> {
  let response = await send(path, options, await accessToken());
  if (response.status === 401) {
    const session = await refreshSession().catch(() => null);
    if (session) response = await send(path, options, session.accessToken);
  }
  if (!response.ok) throw await ApiProblem.fromResponse(response);
  return schema.parse(await response.json());
}
