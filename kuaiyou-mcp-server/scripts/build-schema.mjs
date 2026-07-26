/**
 * Project Zod ReactiveSkillSchema to JSON Schema for diagnostics only.
 * NEVER overwrites the handwritten root schema.json (LLM/App contract).
 */
import { z } from "zod";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ReactiveSkillSchema } from "../build/reactive-skill-schema.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const jsonSchema = z.toJSONSchema(ReactiveSkillSchema);
const required = jsonSchema.required ?? [];
const properties = Object.keys(jsonSchema.properties ?? {});
if (required.length === 0 || properties.length === 0) {
  console.error("Refusing to write projected schema: generated schema is empty.");
  process.exit(1);
}

const outDir = join(__dirname, "../build");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "zod-projected-schema.json");
writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + "\n");
console.log(
  `Wrote diagnostic projection ${outPath} (${properties.length} properties, ${required.length} required).`
);
console.log("Handwritten ../../schema.json is the authoritative contract and was NOT modified.");
