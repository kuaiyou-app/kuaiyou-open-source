import { ReactiveSkillSchema } from "./reactive-skill-schema.js";

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

const KNOWN_ACTION_TYPES = new Set([
  "tap",
  "longTap",
  "typeText",
  "swipe",
  "scrollTo",
  "launchApp",
  "systemAction",
  "storeValue",
  "notify",
  "delay",
  "waitFor",
  "assertion",
  "conditionBranch",
  "loop",
  "runStep",
  "captureScreenshot",
]);

const KNOWN_TRIGGER_TYPES = new Set([
  "elementVisible",
  "elementGone",
  "appInForeground",
  "appNotInForeground",
  "afterGoal",
  "delayedAfterGoal",
  "immediate",
  "anyOf",
  "allOf",
]);

const KNOWN_TERMINATION_TYPES = new Set([
  "allGoalsDone",
  "anyGoalDone",
  "manual",
  "timeout",
  "idleTimeout",
]);

const KNOWN_TARGET_TYPES = new Set([
  "text",
  "desc",
  "id",
  "pos",
  "semantic",
  "image",
  "composite",
]);

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function didYouMean(value: string, known: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  const lower = value.toLowerCase();
  for (const candidate of known) {
    const d = levenshtein(lower, candidate.toLowerCase());
    if (d < bestDist && d <= 3) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
}

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

function lintGoals(skill: Record<string, unknown>, errors: string[], warnings: string[]): void {
  const goals = skill.goals;
  if (!Array.isArray(goals)) return;

  for (let i = 0; i < goals.length; i++) {
    const goal = goals[i];
    if (!goal || typeof goal !== "object") continue;
    const g = goal as Record<string, unknown>;
    const trigger = g.trigger as Record<string, unknown> | undefined;
    const hasAction = g.action !== undefined || (Array.isArray(g.actions) && g.actions.length > 0);
    if (!hasAction && trigger?.type !== "immediate") {
      errors.push(`goals[${i}] (${g.id ?? "?"}): non-immediate goals must include action or actions`);
    }

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

    // Forbidden action aliases / V1 names
    if (FORBIDDEN_ACTION_TYPES.has(type)) {
      const hint = didYouMean(type, KNOWN_ACTION_TYPES);
      errors.push(
        `${path || "root"}: forbidden action type "${type}"` +
          (hint ? ` (did you mean "${hint}"?)` : "") +
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

    // Context-aware unknown-type warnings
    if (path === "termination" || path.endsWith(".termination")) {
      if (!KNOWN_TERMINATION_TYPES.has(type)) {
        const hint = didYouMean(type, KNOWN_TERMINATION_TYPES);
        warnings.push(
          `${path}: unknown termination type "${type}"` + (hint ? ` (did you mean "${hint}"?)` : "")
        );
      }
      return;
    }

    if (node.target !== undefined || path.includes(".target") || path.endsWith(".when") || path.endsWith(".dismiss")) {
      // skip — handled when visiting target objects below via type alone is ambiguous
    }

    // Heuristic: action-like nodes often sit under action/actions
    const isActionPath =
      /(^|\.)action$/.test(path) ||
      /\.actions\[\d+\]$/.test(path) ||
      /\.onTrue\[\d+\]$/.test(path) ||
      /\.onFalse\[\d+\]$/.test(path) ||
      path === "launchApp";
    const isTriggerPath = /(^|\.)trigger$/.test(path) || /\.triggers\[\d+\]$/.test(path);
    const isTargetPath =
      /(^|\.)target$/.test(path) ||
      path.endsWith(".when") ||
      path.endsWith(".dismiss") ||
      /\.fallbacks\[\d+\]$/.test(path);

    if (isActionPath && !KNOWN_ACTION_TYPES.has(type)) {
      const hint = didYouMean(type, KNOWN_ACTION_TYPES);
      warnings.push(
        `${path}: unknown action type "${type}"` + (hint ? ` (did you mean "${hint}"?)` : "")
      );
    } else if (isTriggerPath && !KNOWN_TRIGGER_TYPES.has(type)) {
      const hint = didYouMean(type, KNOWN_TRIGGER_TYPES);
      warnings.push(
        `${path}: unknown trigger type "${type}"` + (hint ? ` (did you mean "${hint}"?)` : "")
      );
    } else if (isTargetPath && !KNOWN_TARGET_TYPES.has(type)) {
      const hint = didYouMean(type, KNOWN_TARGET_TYPES);
      warnings.push(
        `${path}: unknown target type "${type}"` + (hint ? ` (did you mean "${hint}"?)` : "")
      );
    }

    if (isTargetPath && type === "pos") {
      warnings.push(`${path}: prefer semantic/text/id selectors over fragile pos coordinates`);
    }
  });
}

/**
 * Full MCP validation: Zod structure + business lint.
 * Does not read files — caller supplies already-parsed JSON or a JSON string.
 */
export function validateSkillPayload(input: unknown): SkillLintResult {
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

  const zod = ReactiveSkillSchema.safeParse(parsed);
  if (!zod.success) {
    for (const issue of zod.error.issues) {
      errors.push(`${issue.path.join(".") || "root"}: ${issue.message}`);
    }
  }

  const skill = parsed as Record<string, unknown>;
  lintTypes(skill, errors, warnings);
  lintReferences(skill, errors);
  lintGoals(skill, errors, warnings);

  return {
    ok: errors.length === 0,
    parsed: zod.success ? zod.data : parsed,
    errors,
    warnings,
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
