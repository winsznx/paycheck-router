import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type ArtifactRef, MANIFEST_FILE, RunManifest } from "@paycheck-router/shared";

/** JSON with bigints as decimal strings, so u64 values survive. */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`;
}

/**
 * An evidence bundle on disk: raw artifacts addressed by path and SHA-256, and one manifest that
 * is validated against the shared schema before it is written.
 */
export class EvidenceBundle {
  readonly artifacts: ArtifactRef[] = [];

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  /** Stores `content` exactly as given under `relativePath` and returns its reference. */
  write(relativePath: string, content: string): ArtifactRef {
    const path = resolve(this.dir, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    const ref = {
      path: relativePath,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
    this.artifacts.push(ref);
    return ref;
  }

  writeManifest(manifest: Omit<RunManifest, "artifacts">): string {
    const parsed = RunManifest.parse({ ...manifest, artifacts: this.artifacts });
    const path = resolve(this.dir, MANIFEST_FILE);
    writeFileSync(path, toJson(parsed));
    return path;
  }
}
