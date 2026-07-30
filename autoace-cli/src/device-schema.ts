import { createContractValidator, type ContractValidator } from "./contract-schema-validator.js";
import { ensureDevicePaired, httpGetText } from "./device.js";

type CachedValidator = {
  endpoint: string;
  schemaText: string;
  validator: ContractValidator;
};

let cache: CachedValidator | undefined;

/**
 * Always consult the running client for its authoritative contract. Compilation
 * is reused only when the endpoint returns byte-for-byte identical JSON.
 */
export async function fetchDeviceContractValidator(baseUrl: string): Promise<ContractValidator> {
  await ensureDevicePaired(baseUrl);
  const endpoint = `${baseUrl}/api/mcp/schema`;
  const schemaText = await httpGetText(endpoint);

  if (cache?.endpoint === endpoint && cache.schemaText === schemaText) {
    return cache.validator;
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

  cache = { endpoint, schemaText, validator };
  return validator;
}

export function clearDeviceSchemaCache(): void {
  cache = undefined;
}
