"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

/**
 * A small keyed cache for API reads. Realtime events patch entries with `setQueryData`, so a
 * screen re-renders the moment a leg changes without refetching.
 */
export type QueryState<T> =
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "success"; data: T; error: undefined; updatedAt: number }
  | { status: "error"; data: T | undefined; error: Error; updatedAt: number | undefined };

type Entry = {
  state: QueryState<unknown>;
  inflight: Promise<void> | null;
  listeners: Set<() => void>;
};

const LOADING: QueryState<never> = { status: "loading", data: undefined, error: undefined };
const cache = new Map<string, Entry>();

function entry(key: string): Entry {
  let found = cache.get(key);
  if (!found) {
    found = { state: LOADING, inflight: null, listeners: new Set() };
    cache.set(key, found);
  }
  return found;
}

function emit(e: Entry) {
  for (const listener of e.listeners) listener();
}

export function getQueryData<T>(key: string): T | undefined {
  return cache.get(key)?.state.data as T | undefined;
}

export function setQueryData<T>(key: string, update: (current: T | undefined) => T | undefined) {
  const e = entry(key);
  const next = update(e.state.data as T | undefined);
  if (next === undefined) return;
  e.state = { status: "success", data: next, error: undefined, updatedAt: Date.now() };
  emit(e);
}

export function fetchQuery<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  const e = entry(key);
  if (e.inflight) return e.inflight;
  e.inflight = fetcher()
    .then((data) => {
      e.state = { status: "success", data, error: undefined, updatedAt: Date.now() };
    })
    .catch((error: unknown) => {
      const previous = e.state;
      e.state = {
        status: "error",
        data: previous.data,
        error: error instanceof Error ? error : new Error(String(error)),
        updatedAt: previous.status === "loading" ? undefined : previous.updatedAt,
      };
    })
    .finally(() => {
      e.inflight = null;
      emit(e);
    });
  return e.inflight;
}

/**
 * Forgets every cached read. Called when the session ends, so the next account to sign in in
 * this tab never sees the previous one's data, not even for a render.
 */
export function clearQueries() {
  cache.clear();
}

export function invalidateQueries(prefix: string, refetch: (key: string) => void) {
  for (const key of cache.keys()) if (key.startsWith(prefix)) refetch(key);
}

/** Reads `key` from the cache, fetching on mount and whenever the key changes. */
export function useQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): QueryState<T> & { refetch: () => Promise<void> } {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!key) return () => {};
      const e = entry(key);
      e.listeners.add(onChange);
      return () => e.listeners.delete(onChange);
    },
    [key],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => (key ? entry(key).state : LOADING) as QueryState<T>,
    () => LOADING as QueryState<T>,
  );

  const fetcherRef = useRef(fetcher);
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (key) void fetchQuery(key, () => fetcherRef.current());
  }, [key]);

  const refetch = useCallback(
    () => (key ? fetchQuery(key, () => fetcherRef.current()) : Promise.resolve()),
    [key],
  );
  return { ...state, refetch };
}
