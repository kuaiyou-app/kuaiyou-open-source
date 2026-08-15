#!/usr/bin/env node
/**
 * Sync authoritative agent-skills/autoace/ into consumer skill directories.
 *
 * Usage (repo root):
 *   node scripts/sync-autoace-skill.mjs
 *   node scripts/sync-autoace-skill.mjs --cursor-user
 *   node scripts/sync-autoace-skill.mjs --all
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const srcDir = join(repoRoot, "agent-skills", "autoace");

const FILES = ["SKILL.md", "reference.md", "craft.md"];

function syncTo(destDir, label) {
  if (!existsSync(srcDir)) {
    console.error(`Missing source: ${srcDir}`);
    process.exit(1);
  }
  mkdirSync(destDir, { recursive: true });
  for (const name of FILES) {
    const from = join(srcDir, name);
    if (!existsSync(from)) {
      console.error(`Missing ${from}`);
      process.exit(1);
    }
    cpSync(from, join(destDir, name));
  }
  const copied = readdirSync(destDir).filter((f) => FILES.includes(f));
  console.log(`✓ ${label}: ${destDir} (${copied.join(", ")})`);
}

const args = new Set(process.argv.slice(2));
const wantCursorUser = args.has("--cursor-user") || args.has("--all");
const wantAgents = !args.has("--cursor-user") || args.has("--all");

if (wantAgents) {
  syncTo(join(repoRoot, ".agents", "skills", "autoace"), ".agents/skills/autoace");
}

if (wantCursorUser) {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    console.error("HOME/USERPROFILE not set; cannot sync Cursor user skills");
    process.exit(1);
  }
  syncTo(join(home, ".cursor", "skills", "autoace"), "~/.cursor/skills/autoace");
}

if (!wantAgents && !wantCursorUser) {
  console.error("Nothing to do. Use default, --cursor-user, or --all.");
  process.exit(1);
}
