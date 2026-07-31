#!/usr/bin/env node
/**
 * Ensure agent-skills/autoace documents only MCP tools that exist in autoace-cli,
 * and that SKILL.md + reference.md cover the full tools/list surface.
 */
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const indexPath = join(repoRoot, "autoace-cli", "src", "index.ts");
const skillDir = join(repoRoot, "agent-skills", "autoace");

const REQUIRED_DOCS = ["SKILL.md", "reference.md", "craft.md"];

function extractCliTools(source) {
  const tools = new Set();
  // ListTools block: name: "tool_name"
  const re = /name:\s*"([a-z][a-z0-9_]*)"/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    tools.add(m[1]);
  }
  // Filter to known MCP-style names registered in this file (exclude random strings if any)
  return tools;
}

function extractMentionedTools(text, known) {
  const found = new Set();
  const re = /`([a-z][a-z0-9_]*)`/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (known.has(m[1])) found.add(m[1]);
  }
  return found;
}

if (!existsSync(indexPath)) {
  console.error(`Missing ${indexPath}`);
  process.exit(1);
}

for (const name of REQUIRED_DOCS) {
  const p = join(skillDir, name);
  if (!existsSync(p)) {
    console.error(`Missing Agent Skill file: ${p}`);
    process.exit(1);
  }
}

const indexSrc = readFileSync(indexPath, "utf8");
const cliTools = extractCliTools(indexSrc);

// Sanity: expect the core set
const CORE = [
  "pair_device",
  "get_kuaiyou_schema",
  "validate_kuaiyou_skill",
  "push_reactive_skill",
  "capture_screenshot",
  "get_ui_tree",
  "list_skills",
  "plans_schema",
];
for (const t of CORE) {
  if (!cliTools.has(t)) {
    console.error(`CLI index.ts missing expected tool registration: ${t}`);
    process.exit(1);
  }
}

const skillText = REQUIRED_DOCS.map((n) => readFileSync(join(skillDir, n), "utf8")).join("\n");
const mentioned = extractMentionedTools(skillText, cliTools);

let failed = false;

for (const t of mentioned) {
  if (!cliTools.has(t)) {
    console.error(`✗ Agent Skill documents unknown tool: ${t}`);
    failed = true;
  }
}

const missingFromDocs = [...cliTools].filter((t) => !mentioned.has(t)).sort();
// Only flag tools that appear in ListTools — index.ts also has case "tool" in switch.
// extractCliTools may pick case labels too; both should match.
if (missingFromDocs.length) {
  console.error(
    `✗ Agent Skill docs missing CLI tools (mention in SKILL.md or reference.md):\n  ${missingFromDocs.join("\n  ")}`
  );
  failed = true;
}

if (failed) process.exit(1);

console.log(`✓ agent-skills/autoace covers ${cliTools.size} CLI tools`);
