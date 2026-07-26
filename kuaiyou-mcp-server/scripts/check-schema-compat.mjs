/**
 * CI gate: handwritten root schema.json must remain the checked-in contract.
 * Optionally regenerates the Zod projection for diagnostics (never overwrites schema.json).
 */
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const schemaPath = join(repoRoot, "schema.json");

if (!existsSync(schemaPath)) {
  console.error(`Missing authoritative schema: ${schemaPath}`);
  process.exit(1);
}

const before = createHash("sha256").update(readFileSync(schemaPath)).digest("hex");

// Ensure projection can be built (does not touch schema.json).
execFileSync("node", [join(__dirname, "build-schema.mjs")], { stdio: "inherit" });

const after = createHash("sha256").update(readFileSync(schemaPath)).digest("hex");
if (before !== after) {
  console.error("FATAL: schema.json was modified — handwritten contract must not be overwritten.");
  process.exit(1);
}

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
if (!schema.$id || !schema.definitions?.GoalAction) {
  console.error("schema.json does not look like the handwritten ReactiveSkill contract.");
  process.exit(1);
}

// Ensure forbidden aliases are not declared in the public schema.
const blob = JSON.stringify(schema);
for (const banned of ["readText", "setClipboard", "askAgent"]) {
  if (blob.includes(`"const":"${banned}"`) || blob.includes(`"const": "${banned}"`)) {
    console.error(`schema.json must not declare forbidden action const "${banned}"`);
    process.exit(1);
  }
}

console.log("schema.json integrity OK (handwritten contract unchanged).");
