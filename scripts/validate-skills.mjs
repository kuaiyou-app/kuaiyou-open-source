// Performs offline JSON and business-lint checks for repository examples,
// the public skills catalog, and device fixtures.
// Client contract validation happens through GET /api/mcp/schema at runtime.
import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { createSkillIndex } = require("./build-skill-index.js");
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const skillsDir = join(repoRoot, "skills");
const examplesDir = join(repoRoot, "examples");
const fixturesDir = join(repoRoot, "autoace-cli", "fixtures", "device");

const lintModulePath = join(repoRoot, "autoace-cli", "build", "skill-lint.mjs");
if (!existsSync(lintModulePath)) {
  console.error(
    "Missing autoace-cli build output. Run `npm ci && npm run build` " +
      "inside autoace-cli/ before validating skills."
  );
  process.exit(1);
}
const { validateSkillPayload } = await import(pathToFileURL(lintModulePath).href);

const BANNED = ["readText", "setClipboard", "askAgent"];

function collectJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => join(dir, f));
}

let failed = false;
const ids = new Set();

for (const filePath of [
  ...collectJsonFiles(skillsDir),
  ...collectJsonFiles(examplesDir),
  ...collectJsonFiles(fixturesDir),
]) {
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
    console.error(`✗ ${rel} (business lint):\n  ${lint.errors.join("\n  ")}`);
    failed = true;
  }

  if (lint.ok) {
    if (filePath.startsWith(skillsDir + "/") || filePath === skillsDir) {
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

// Verify the generated index contract in memory. Validation must remain read-only;
// the website workflow invokes build-skill-index.js explicitly when it needs a file.
const index = createSkillIndex(skillsDir);
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
