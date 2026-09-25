"use client";

import { useSyncExternalStore } from "react";

/**
 * PRD 15.4: one preference that merges prefers-reduced-motion, the in-app Reduced motion
 * setting (`<html data-motion="reduced">`) and Data saver (`<html data-data-saver="on">`,
 * `navigator.connection.saveData`, or an effective type of 2g/3g).
 */
export type MotionPreference = "full" | "reduced";

type NetworkInformation = EventTarget & { saveData?: boolean; effectiveType?: string };

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function connection(): NetworkInformation | undefined {
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

export function isDataSaverActive(): boolean {
  const root = document.documentElement;
  if (root.dataset.dataSaver === "on") return true;
  const info = connection();
  if (!info) return false;
  return (
    info.saveData === true ||
    info.effectiveType === "2g" ||
    info.effectiveType === "3g" ||
    info.effectiveType === "slow-2g"
  );
}

function readPreference(): MotionPreference {
  if (window.matchMedia(REDUCED_QUERY).matches) return "reduced";
  if (document.documentElement.dataset.motion === "reduced") return "reduced";
  return isDataSaverActive() ? "reduced" : "full";
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-motion", "data-data-saver"],
  });
  const info = connection();
  info?.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
    observer.disconnect();
    info?.removeEventListener("change", onChange);
  };
}

/** Server render assumes the reduced form so the first paint never animates unexpectedly. */
export function useMotionPreference(): MotionPreference {
  return useSyncExternalStore(subscribe, readPreference, () => "reduced");
}

export function useDataSaver(): boolean {
  return useSyncExternalStore(subscribe, isDataSaverActive, () => false);
}
