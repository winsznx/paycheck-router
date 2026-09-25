"use client";

import { api } from "@paycheck-router/shared";
import { useSyncExternalStore } from "react";
import { apiUrl } from "./env.ts";
import { accessToken } from "./session.ts";

/**
 * One WebSocket per tab to the user's UserHub (PRD 11.4). Reconnects resume from the last
 * event id so the hub replays anything missed; handlers receive validated events only.
 */
export type ConnectionState = "idle" | "connecting" | "live" | "reconnecting";

type Handler = (event: api.ServerEvent) => void;

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const PING_MS = 25_000;

const handlers = new Set<Handler>();
const stateListeners = new Set<() => void>();
let connection: ConnectionState = "idle";
let socket: WebSocket | null = null;
let lastEventId: string | null = null;
let attempt = 0;
let retryTimer: number | undefined;
let pingTimer: number | undefined;
let users = 0;

function setConnection(next: ConnectionState) {
  connection = next;
  for (const listener of stateListeners) listener();
}

function realtimeUrl(): string {
  return `${apiUrl.replace(/^http/, "ws")}/realtime`;
}

function dispatch(raw: string) {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return;
  }
  const event = api.ServerEvent.safeParse(json);
  if (!event.success) return;
  lastEventId = event.data.id;
  for (const handler of handlers) handler(event.data);
}

function scheduleReconnect() {
  if (users === 0) return;
  setConnection("reconnecting");
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 30_000;
  attempt += 1;
  retryTimer = window.setTimeout(() => {
    void open();
  }, delay);
}

async function open() {
  if (socket || users === 0) return;
  setConnection(attempt === 0 ? "connecting" : "reconnecting");
  const token = await accessToken();
  if (!token || users === 0) {
    setConnection("idle");
    return;
  }
  const ws = new WebSocket(realtimeUrl(), [
    api.REALTIME_PROTOCOL,
    `${api.REALTIME_BEARER_PREFIX}${token}`,
  ]);
  socket = ws;
  ws.addEventListener("open", () => {
    attempt = 0;
    setConnection("live");
    const resume: api.ClientMessage = { type: "resume", lastEventId };
    ws.send(JSON.stringify(resume));
    pingTimer = window.setInterval(() => {
      const ping: api.ClientMessage = { type: "ping" };
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ping));
    }, PING_MS);
  });
  ws.addEventListener("message", (message) => {
    if (typeof message.data === "string") dispatch(message.data);
  });
  ws.addEventListener("close", () => {
    window.clearInterval(pingTimer);
    socket = null;
    scheduleReconnect();
  });
}

function close() {
  window.clearTimeout(retryTimer);
  window.clearInterval(pingTimer);
  socket?.close(1000, "no subscribers");
  socket = null;
  attempt = 0;
  setConnection("idle");
}

/** Starts the shared connection for the lifetime of the returned cleanup. */
export function retainRealtime(): () => void {
  users += 1;
  if (users === 1) void open();
  return () => {
    users -= 1;
    if (users === 0) close();
  };
}

export function onRealtimeEvent(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function subscribePrices(mints: readonly string[]) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const message: api.ClientMessage = { type: "subscribe.prices", mints: [...mints] };
  socket.send(JSON.stringify(message));
}

export function useRealtimeConnection(): ConnectionState {
  return useSyncExternalStore(
    (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    () => connection,
    () => "idle",
  );
}
