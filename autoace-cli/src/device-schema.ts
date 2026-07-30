import { createContractValidator, type ContractValidator } from "./contract-schema-validator.js";
import { ensureDevicePaired, httpGetText } from "./device.js";

/** Skill contract — GET /api/mcp/schema */
export const SKILL_SCHEMA_PATH = "/api/mcp/schema";
/** Learning-plan contract — GET /api/mcp/plans/schema (never mirrored into this repo) */
export const PLAN_SCHEMA_PATH = "/api/mcp/plans/schema";

type CachedValidator = {
  endpoint: string;
  schemaText: string;
  validator: ContractValidator;
};

/** One cache entry per schema endpoint so skill and plan contracts stay independent. */
const caches = new Map<string, CachedValidator>();

/**
 * Always consult the running client for its authoritative contract. Compilation
 * is reused only when the same endpoint returns byte-for-byte identical JSON.
 *
 * @param schemaPath Device path; default is the skill schema. Pass
 *   {@link PLAN_SCHEMA_PATH} for domain-coach learning plans.
 */
export async function fetchDeviceContractValidator(
  baseUrl: string,
  schemaPath: string = SKILL_SCHEMA_PATH
): Promise<ContractValidator> {
  await ensureDevicePaired(baseUrl);
  const endpoint = `${baseUrl.replace(/\/+$/, "")}${schemaPath.startsWith("/") ? schemaPath : `/${schemaPath}`}`;
  const schemaText = await httpGetText(endpoint);

  const hit = caches.get(endpoint);
  if (hit && hit.schemaText === schemaText) {
    return hit.validator;
  }

  let schema: unknown;
  try {
    schema = JSON.parse(schemaText);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Device returned invalid schema JSON: ${detail}`);
  }

  let validator: ContractValidator;
  try {
    validator = createContractValidator(schema);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Device returned an unusable JSON Schema: ${detail}`);
  }

  caches.set(endpoint, { endpoint, schemaText, validator });
  return validator;
}

export function clearDeviceSchemaCache(): void {
  caches.clear();
}
