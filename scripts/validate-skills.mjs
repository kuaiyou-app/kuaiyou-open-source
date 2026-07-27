// Validates every skills/*.json and examples/*.json against:
// 1) ReactiveSkillSchema (Zod) + skill-lint forbidden aliases / refs
// 2) Handwritten root schema.json (JSON Schema via Ajv)
// Also verifies the generated index contract.
import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const skillsDir = join(repoRoot, "skills");
const examplesDir = join(repoRoot, "examples");

const schemaModulePath = join(
  repoRoot,
  "autoace-cli",
  "build",
  "reactive-skill-schema.mjs"
);
const lintModulePath = join(repoRoot, "autoace-cli", "build", "skill-lint.mjs");
if (!existsSync(schemaModulePath) || !existsSync(lintModulePath)) {
  console.error(
    "Missing autoace-cli build output. Run `npm ci && npm run build` " +
      "inside autoace-cli/ before validating skills."
  );
  process.exit(1);
}
const { validateSkillPayload } = await import(pathToFileURL(lintModulePath).href);

let Ajv;
try {
  ({ default: Ajv } = await import("ajv"));
} catch {
  // Prefer mcp-server's ajv if installed there
  try {
    Ajv = require(join(repoRoot, "autoace-cli/node_modules/ajv"));
  } catch {
    console.error("Ajv is required. Install with: npm install ajv --prefix autoace-cli");
    process.exit(1);
  }
}

const draftSchema = JSON.parse(readFileSync(join(repoRoot, "schema.json"), "utf8"));
// Ajv draft-07: strip $schema if draft-2020 to avoid hard failure; handwritten uses draft-07.
const ajv = new Ajv({ allErrors: true, strict: false });
const validateJsonSchema = ajv.compile(draftSchema);

const BANNED = ["readText", "setClipboard", "askAgent"];

function collectJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => join(dir, f));
}

let failed = false;
const ids = new Set();

for (const filePath of [...collectJsonFiles(skillsDir), ...collectJsonFiles(examplesDir)]) {
  const rel = filePath.slice(repoRoot.length + 1);
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(`✗ ${rel}: invalid JSON — ${e.message}`);
    failed = true;
    continue;
  }

  const blob = JSON.stringify(data);
  for (const banned of BANNED) {
    if (blob.includes(`"type":"${banned}"`) || blob.includes(`"type": "${banned}"`)) {
      console.error(`✗ ${rel}: contains forbidden type "${banned}"`);
      failed = true;
    }
  }

  const lint = validateSkillPayload(data);
  if (!lint.ok) {
    console.error(`✗ ${rel} (Zod/lint):\n  ${lint.errors.join("\n  ")}`);
    failed = true;
  }

  const jsOk = validateJsonSchema(data);
  if (!jsOk) {
    const errs = (validateJsonSchema.errors || [])
      .map((e) => `${e.instancePath || "/"} ${e.message}`)
      .join("\n  ");
    console.error(`✗ ${rel} (JSON Schema):\n  ${errs}`);
    failed = true;
  }

  if (lint.ok && jsOk) {
    if (filePath.startsWith(skillsDir)) {
      if (ids.has(data.id)) {
        console.error(`✗ ${rel}: duplicate id "${data.id}"`);
        failed = true;
      }
      ids.add(data.id);
    }
    const warnNote = lint.warnings.length ? ` (${lint.warnings.length} warning(s))` : "";
    console.log(`✓ ${rel}${warnNote}`);
  }
}

// Verify the index contract for skills only
execFileSync("node", [join(repoRoot, "scripts/build-skill-index.js")], { stdio: "inherit" });
const index = JSON.parse(readFileSync(join(skillsDir, "index.json"), "utf8"));
if (!Array.isArray(index.skills)) {
  console.error("✗ index.json: expected { skills: [...] } shape");
  failed = true;
} else if (index.skills.length !== ids.size) {
  console.error(`✗ index.json: has ${index.skills.length} entries but ${ids.size} valid skills exist`);
  failed = true;
} else {
  console.log(`✓ index.json contract: ${index.skills.length} skills`);
}

if (failed) {
  process.exit(1);
}
console.log("All skills and examples valid.");
