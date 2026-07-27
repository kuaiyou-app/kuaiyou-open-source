#!/usr/bin/env node
/**
 * Gate: every closed value set in schema.json must be enforced identically by
 * the CLI validator.
 *
 * Why this exists: schema.json and the Zod validator drifted silently twice.
 * `constraints.executionMode` was declared `z.string()`, so the CLI reported
 * "Validation successful" for `ONCE` and the device answered
 * "GoalExecutionMode does not contain element with name 'ONCE'". Separately,
 * schema.json documented `debugStatus: TESTED | PENDING_TEST`, values the App
 * has never had. Both were only found by pushing to a real phone.
 *
 * The client (App) is the contract owner. schema.json mirrors it, and this
 * script makes the CLI provably agree with schema.json, so a future edit on
 * either side fails CI instead of failing on someone's phone.
 *
 * Usage: node scripts/check-enum-parity.mjs
 * Requires: kuaiyou-mcp-server/build/zod-projected-schema.json (npm run build:schema)
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(repoRoot, "schema.json");
const projectionPath = join(
  repoRoot,
  "kuaiyou-mcp-server",
  "build",
  "zod-projected-schema.json"
);

for (const [label, p] of [
  ["schema.json", schemaPath],
  ["zod projection", projectionPath],
]) {
  if (!existsSync(p)) {
    console.error(`Missing ${label}: ${p}`);
    if (p === projectionPath) {
      console.error("Run: cd kuaiyou-mcp-server && npm run build:schema");
    }
    process.exit(1);
  }
}

/**
 * Collect `fieldName -> Set(allowed values)` for every string enum, keyed by
 * property name. Property names are unique per concept in this contract
 * (executionMode is the one exception and is handled below), so name-keying
 * avoids having to align schema.json's `definitions` with Zod's inlined shapes.
 */
function collectEnums(node, key = null, out = new Map()) {
  if (Array.isArray(node)) {
    for (const item of node) collectEnums(item, key, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;

  if (key && Array.isArray(node.enum) && node.enum.every((v) => typeof v === "string")) {
    if (!out.has(key)) out.set(key, new Set());
    for (const v of node.enum) out.get(key).add(v);
  }

  for (const [childKey, value] of Object.entries(node)) {
    // Under "properties" the keys are field names; elsewhere keep the inherited
    // field name so anyOf/oneOf/definitions wrappers don't lose context.
    if (childKey === "properties" && value && typeof value === "object") {
      for (const [field, sub] of Object.entries(value)) collectEnums(sub, field, out);
    } else if (childKey === "enum") {
      continue;
    } else {
      collectEnums(value, key, out);
    }
  }
  return out;
}

const schemaEnums = collectEnums(JSON.parse(readFileSync(schemaPath, "utf8")));
const zodEnums = collectEnums(JSON.parse(readFileSync(projectionPath, "utf8")));

// `executionMode` legitimately means two different sets: skill-level
// (REACTIVE, plus the App's SEQUENTIAL legacy alias) and goal-level
// (SINGLE | REPEAT). Name-keying merges them, so compare it as a union and
// allow the validator to additionally accept the documented legacy alias.
const LEGACY_ALIASES = { executionMode: ["SEQUENTIAL"] };

const problems = [];
for (const [field, expected] of schemaEnums) {
  const actual = zodEnums.get(field);
  if (!actual) {
    problems.push(
      `${field}: schema.json restricts it to [${[...expected].join(", ")}] but the validator does not enforce any set`
    );
    continue;
  }
  const allowedExtra = new Set(LEGACY_ALIASES[field] ?? []);
  const missing = [...expected].filter((v) => !actual.has(v));
  const extra = [...actual].filter((v) => !expected.has(v) && !allowedExtra.has(v));
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length) parts.push(`validator rejects documented value(s): ${missing.join(", ")}`);
    if (extra.length) parts.push(`validator accepts undocumented value(s): ${extra.join(", ")}`);
    problems.push(`${field}: ${parts.join("; ")}`);
  }
}

const checked = schemaEnums.size;
if (problems.length) {
  console.error(`Enum parity FAILED (${problems.length}/${checked} field(s) disagree):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nThe App is the contract owner. Fix schema.json to match the App enums, then mirror the change in kuaiyou-mcp-server/src/reactive-skill-schema.ts."
  );
  process.exit(1);
}

console.log(`Enum parity OK: ${checked} closed value set(s) enforced identically.`);
for (const [field, values] of [...schemaEnums].sort()) {
  console.log(`  ${field}: ${[...values].sort().join(" | ")}`);
}
