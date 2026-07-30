import { pathToString, type ContractValidator } from "./contract-schema-validator.js";

export type SkillLintResult = {
  ok: boolean;
  parsed: unknown | null;
  errors: string[];
  warnings: string[];
};

/** Types that must never ship for local execution. */
export const FORBIDDEN_ACTION_TYPES = new Set([
  "askAgent",
  "readText",
  "setClipboard",
  "ClickAction",
  "SetClipboardAction",
  "ReadTextAction",
]);

const FORBIDDEN_TRIGGER_TYPES = new Set([
  "AllGoalsComplete", // misuse as trigger
]);

const FORBIDDEN_TERMINATION_TYPES = new Set([
  "AllGoalsComplete",
  "Timeout", // V1 used Timeout + timeoutMs; v2 is timeout + maxDurationMs
]);


function walk(obj: unknown, visit: (node: Record<string, unknown>, path: string) => void, path = ""): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walk(item, visit, `${path}[${i}]`));
    return;
  }
  const rec = obj as Record<string, unknown>;
  visit(rec, path);
  for (const [k, v] of Object.entries(rec)) {
    walk(v, visit, path ? `${path}.${k}` : k);
  }
}

function collectGoalIds(skill: Record<string, unknown>): string[] {
  const goals = skill.goals;
  if (!Array.isArray(goals)) return [];
  return goals
    .map((g) => (g && typeof g === "object" ? (g as Record<string, unknown>).id : undefined))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function collectAfterGoalEdges(skill: Record<string, unknown>): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  const goals = skill.goals;
  if (!Array.isArray(goals)) return edges;

  const visitTrigger = (trigger: unknown, fromId: string) => {
    if (!trigger || typeof trigger !== "object") return;
    const t = trigger as Record<string, unknown>;
    if ((t.type === "afterGoal" || t.type === "delayedAfterGoal") && typeof t.goalId === "string") {
      edges.push({ from: fromId, to: t.goalId });
    }
    if (Array.isArray(t.triggers)) {
      t.triggers.forEach((child) => visitTrigger(child, fromId));
    }
  };

  for (const goal of goals) {
    if (!goal || typeof goal !== "object") continue;
    const g = goal as Record<string, unknown>;
    if (typeof g.id !== "string") continue;
    visitTrigger(g.trigger, g.id);
  }
  return edges;
}

function findCycles(edges: Array<{ from: string; to: string }>): string[] | null {
  const adj = new Map<string, string[]>();
  for (const { from, to } of edges) {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push(to);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const dfs = (node: string): string[] | null => {
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      return stack.slice(idx).concat(node);
    }
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const cycle = dfs(next);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  };

  for (const node of adj.keys()) {
    const cycle = dfs(node);
    if (cycle) return cycle;
  }
  return null;
}

function lintReferences(skill: Record<string, unknown>, errors: string[]): void {
  const goalIds = collectGoalIds(skill);
  const idSet = new Set(goalIds);
  const seen = new Set<string>();
  for (const id of goalIds) {
    if (seen.has(id)) errors.push(`Duplicate goal id "${id}"`);
    seen.add(id);
  }

  walk(skill, (node, path) => {
    if (typeof node.type !== "string") return;
    if (
      (node.type === "afterGoal" || node.type === "delayedAfterGoal" || node.type === "runStep") &&
      typeof node.goalId === "string" &&
      !idSet.has(node.goalId)
    ) {
      errors.push(`${path || "root"}: ${node.type} references missing goalId "${node.goalId}"`);
    }
  });

  const cycle = findCycles(collectAfterGoalEdges(skill));
  if (cycle) {
    errors.push(`afterGoal cycle detected: ${cycle.join(" -> ")}`);
  }
}

function lintGoals(skill: Record<string, unknown>, warnings: string[]): void {
  const goals = skill.goals;
  if (!Array.isArray(goals)) return;

  for (let i = 0; i < goals.length; i++) {
    const goal = goals[i];
    if (!goal || typeof goal !== "object") continue;
    const g = goal as Record<string, unknown>;
    const constraints = (g.constraints ?? {}) as Record<string, unknown>;
    const maxExecutions = constraints.maxExecutions;
    const executionMode = constraints.executionMode ?? skill.executionMode;
    const termination = skill.termination as Record<string, unknown> | undefined;
    if (
      executionMode === "REPEAT" &&
      (maxExecutions === 0 || maxExecutions === undefined) &&
      (!termination || termination.type === "allGoalsDone" || termination.type === undefined)
    ) {
      warnings.push(
        `goals[${i}] (${g.id ?? "?"}): REPEAT with unlimited maxExecutions and no timeout termination may run forever`
      );
    }
  }
}

function lintTypes(skill: unknown, errors: string[], warnings: string[]): void {
  walk(skill, (node, path) => {
    if (typeof node.type !== "string") return;
    const type = node.type;

    if (FORBIDDEN_ACTION_TYPES.has(type)) {
      errors.push(
        `${path || "root"}: forbidden action type "${type}"` +
          (type === "readText" || type === "setClipboard"
            ? '; use storeValue (source.screen / source.template)'
            : "")
      );
      return;
    }
    if (FORBIDDEN_TERMINATION_TYPES.has(type) && (path === "termination" || path.endsWith(".termination"))) {
      const hint = type === "Timeout" ? "timeout" : "allGoalsDone";
      errors.push(`${path}: forbidden termination type "${type}" (did you mean "${hint}"?)`);
      return;
    }
    if (FORBIDDEN_TRIGGER_TYPES.has(type)) {
      errors.push(`${path}: forbidden trigger type "${type}"`);
      return;
    }

    const isTargetPath =
      /(^|\.)target$/.test(path) ||
      path.endsWith(".when") ||
      path.endsWith(".dismiss") ||
      path.endsWith(".selector") ||
      path.endsWith(".scope") ||
      path.endsWith(".item") ||
      path.endsWith(".value") ||
      /\.fallbacks\[\d+\]$/.test(path);

    if (isTargetPath && type === "pos") {
      warnings.push(`${path}: prefer semantic/text/id selectors over fragile pos coordinates`);
    }
  });
}

/**
 * Parse and lint a skill. When supplied, contractValidator is compiled from
 * the schema returned by the running client.
 */
export function validateSkillPayload(
  input: unknown,
  contractValidator?: ContractValidator
): SkillLintResult {
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
    return { ok: false, parsed: null, errors: ["Skill payload must be a JSON object"], warnings: [] };
  }

  if (contractValidator) {
    const contract = contractValidator(parsed);
    if (!contract.ok) {
      for (const issue of contract.issues) {
        errors.push(`${pathToString(issue.path)}: ${issue.message}`);
      }
    }
  }

  const skill = parsed as Record<string, unknown>;
  lintTypes(skill, errors, warnings);
  lintReferences(skill, errors);
  lintGoals(skill, warnings);

  const dedupe = (items: string[]) => [...new Set(items)];

  return {
    ok: errors.length === 0,
    parsed,
    errors: dedupe(errors),
    warnings: dedupe(warnings),
  };
}

export function formatLintResult(result: SkillLintResult): string {
  const lines: string[] = [];
  if (result.ok) {
    lines.push("Validation successful! The JSON is a valid Kuaiyou skill.");
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
