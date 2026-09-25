#!/usr/bin/env node
/**
 * PRD 17.4: every locale carries exactly the keys in messages/en.json, with the same ICU
 * arguments, and every key is used by the source.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "es-419", "pt-BR", "fr"];
const errors = [];

function flatten(object, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(object)) {
    const id = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value, id, out);
    else out.set(id, String(value));
  }
  return out;
}

/** Argument names used anywhere in an ICU message, including inside plural and select branches. */
function collectArguments(elements, names) {
  for (const element of elements) {
    if (element.type === TYPE.literal || element.type === TYPE.pound) continue;
    if ("value" in element && typeof element.value === "string") names.add(element.value);
    if ("options" in element) {
      for (const option of Object.values(element.options)) collectArguments(option.value, names);
    }
    if (element.type === TYPE.tag) collectArguments(element.children, names);
  }
  return names;
}

function argumentsOf(message, where) {
  try {
    return [...collectArguments(parse(message), new Set())].sort().join(",");
  } catch (error) {
    errors.push(`${where}: invalid ICU message (${error.message})`);
    return "";
  }
}

const catalogs = Object.fromEntries(
  await Promise.all(
    LOCALES.map(async (locale) => [
      locale,
      flatten(JSON.parse(await readFile(path.join(appDir, "messages", `${locale}.json`), "utf8"))),
    ]),
  ),
);

const source = catalogs.en;
for (const locale of LOCALES.slice(1)) {
  const catalog = catalogs[locale];
  for (const [key, message] of source) {
    if (!catalog.has(key)) errors.push(`${locale}: missing ${key}`);
    else if (
      argumentsOf(catalog.get(key), `${locale} ${key}`) !== argumentsOf(message, `en ${key}`)
    ) {
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

/**
 * A key counts as used when any namespace-relative suffix appears as a literal ("status.waiting")
 * or as the static prefix of a template key (`status.${leg.status}`).
 */
function isUsed(key) {
  const parts = key.split(".");
  for (let start = 0; start < parts.length; start++) {
    const suffix = parts.slice(start).join(".");
    if (corpus.includes(`"${suffix}"`) || corpus.includes(`\`${suffix}\``)) return true;
    for (let end = start + 1; end < parts.length; end++) {
      if (corpus.includes(`\`${parts.slice(start, end).join(".")}.\${`)) return true;
    }
  }
  return false;
}

for (const key of source.keys()) {
  if (!isUsed(key)) errors.push(`en: unused ${key}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`check-messages: ${source.size} keys × ${LOCALES.length} locales`);
