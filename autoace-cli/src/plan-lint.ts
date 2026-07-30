import { pathToString, type ContractValidator } from "./contract-schema-validator.js";

export type PlanLintResult = {
  ok: boolean;
  parsed: unknown | null;
  errors: string[];
  warnings: string[];
};

/**
 * Parse a LearningPlan JSON and optionally validate against the device's
 * GET /api/mcp/plans/schema contract. Structural/DAG checks stay on-device
 * (POST /api/mcp/plans/validate); this repo never embeds the plan schema.
 */
export function validatePlanPayload(
  input: unknown,
  contractValidator?: ContractValidator
): PlanLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch (e: any) {
      return { ok: false, parsed: null, errors: [`Invalid JSON format: ${e.message}`], warnings: [] };
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, parsed: null, errors: ["Plan payload must be a JSON object"], warnings: [] };
  }

  if (contractValidator) {
    const contract = contractValidator(parsed);
    if (!contract.ok) {
      for (const issue of contract.issues) {
        errors.push(`${pathToString(issue.path)}: ${issue.message}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    parsed,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}

export function formatPlanLintResult(result: PlanLintResult): string {
  const lines: string[] = [];
  if (result.ok) {
    lines.push("Validation successful! The JSON matches the device learning-plan schema.");
  } else {
    lines.push("Validation failed with errors:");
    lines.push(...result.errors.map((e) => `- ${e}`));
  }
  if (result.warnings.length > 0) {
    lines.push("Warnings:");
    lines.push(...result.warnings.map((w) => `- ${w}`));
  }
  return lines.join("\n");
}
