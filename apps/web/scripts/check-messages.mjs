#!/usr/bin/env node
/**
 * PRD 17.4: every locale carries exactly the keys in messages/en.json, with the same ICU
 * arguments, and every key is used by the source.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "es-419", "pt-BR", "fr"];

function flatten(object, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(object)) {
    const id = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value, id, out);
    else out.set(id, String(value));
  }
  return out;
}

const argumentsOf = (message) =>
  [...message.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*(?:,|\})/g)]
    .map((m) => m[1])
    .sort()
    .join(",");

const catalogs = Object.fromEntries(
  await Promise.all(
    LOCALES.map(async (locale) => [
      locale,
      flatten(JSON.parse(await readFile(path.join(appDir, "messages", `${locale}.json`), "utf8"))),
    ]),
  ),
);

const errors = [];
const source = catalogs.en;
for (const locale of LOCALES.slice(1)) {
  const catalog = catalogs[locale];
  for (const [key, message] of source) {
    if (!catalog.has(key)) errors.push(`${locale}: missing ${key}`);
    else if (argumentsOf(catalog.get(key)) !== argumentsOf(message)) {
      errors.push(`${locale}: ${key} arguments differ from en`);
    }
  }
  for (const key of catalog.keys()) if (!source.has(key)) errors.push(`${locale}: extra ${key}`);
}

async function* sourceFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) yield full;
  }
}

let corpus = "";
for await (const file of sourceFiles(path.join(appDir, "src")))
  corpus += await readFile(file, "utf8");

const namespaces = new Set([...source.keys()].map((key) => key.split(".")[0]));
for (const key of source.keys()) {
  const [namespace, ...rest] = key.split(".");
  const leaf = rest.join(".");
  const used =
    corpus.includes(`"${key}"`) ||
    (namespaces.has(namespace) && (corpus.includes(`"${leaf}"`) || corpus.includes(`\`${leaf}`)));
  if (!used) errors.push(`en: unused ${key}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`check-messages: ${source.size} keys × ${LOCALES.length} locales`);
