import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AnchorIdl, rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { createFromRoot } from "codama";

const packageFolder = resolve(import.meta.dirname, "..");
const idlPath = resolve(packageFolder, "..", "..", "idl", "paycheck_router.json");
const idl = JSON.parse(readFileSync(idlPath, "utf8")) as AnchorIdl;

await createFromRoot(rootNodeFromAnchor(idl)).accept(
  renderVisitor(packageFolder, {
    generatedFolder: "src/generated",
    syncPackageJson: false,
    kitImportStrategy: "rootOnly",
    importExtension: "ts",
  }),
);
console.log(`generated src/generated from ${idlPath}`);
