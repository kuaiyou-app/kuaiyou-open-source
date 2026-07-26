import { z } from "zod";

/**
 * Structural schema for ReactiveSkill JSON (MCP projection of the handwritten
 * root schema.json / Android GoalAction contract).
 *
 * - Objects are "loose" (unknown fields preserved).
 * - Known action/trigger field requirements are enforced via superRefine.
 * - Unknown types pass structurally; skill-lint.ts emits warnings / rejects
 *   forbidden aliases (readText, setClipboard, askAgent, V1 names).
 */

const nonEmptyString = z.string().min(1);
/** Millisecond durations/counts: integers, never negative. */
const nonNegativeMs = z.number().int().nonnegative();
/** Screen-relative coordinates ("Pct" suffix) are fractions in [0, 1]. */
const pct = z.number().min(0).max(1);

type LooseRecord = Record<string, unknown>;

function requireField(obj: LooseRecord, ctx: z.RefinementCtx, field: string): void {
  if (obj[field] === undefined) {
    ctx.addIssue({
      code: "custom",
      path: [field],
      message: `type "${obj.type}" requires "${field}"`,
    });
  }
}

function requireNonEmptyArray(obj: LooseRecord, ctx: z.RefinementCtx, field: string): void {
  const value = obj[field];
  if (!Array.isArray(value) || value.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: [field],
      message: `type "${obj.type}" requires a non-empty "${field}" array`,
    });
  }
}

const TargetSchema = z.looseObject({
  type: nonEmptyString,
  text: z.string().optional(),
  desc: z.string().optional(),
  viewId: z.string().optional(),
  exact: z.boolean().optional(),
  textExact: z.boolean().optional(),
  index: z.number().int().optional(),
  description: z.string().optional(),
  hintText: z.string().optional(),
  hintDesc: z.string().optional(),
  xPct: pct.optional(),
  yPct: pct.optional(),
}).superRefine((target, ctx) => {
  switch (target.type) {
    case "text":
      requireField(target, ctx, "text");
      break;
    case "desc":
      requireField(target, ctx, "desc");
      break;
    case "id":
      requireField(target, ctx, "viewId");
      break;
    case "pos":
      requireField(target, ctx, "xPct");
      requireField(target, ctx, "yPct");
      break;
    case "composite":
      requireField(target, ctx, "text");
      requireField(target, ctx, "textExact");
      requireField(target, ctx, "index");
      break;
    case "semantic":
      requireField(target, ctx, "description");
      break;
  }
});

const TriggerSchema = z.looseObject({
  type: nonEmptyString,
  target: TargetSchema.optional(),
  packageName: z.string().optional(),
  goalId: z.string().optional(),
  delayMs: nonNegativeMs.optional(),
  get triggers() {
    return z.array(TriggerSchema).optional();
  },
}).superRefine((trigger, ctx) => {
  switch (trigger.type) {
    case "elementVisible":
    case "elementGone":
      requireField(trigger, ctx, "target");
      break;
    case "appInForeground":
    case "appNotInForeground":
      requireField(trigger, ctx, "packageName");
      break;
    case "afterGoal":
      requireField(trigger, ctx, "goalId");
      break;
    case "delayedAfterGoal":
      requireField(trigger, ctx, "goalId");
      requireField(trigger, ctx, "delayMs");
      break;
    case "allOf":
    case "anyOf":
      requireNonEmptyArray(trigger, ctx, "triggers");
      break;
  }
});

const ConditionSchema = z.looseObject({
  type: nonEmptyString,
  target: TargetSchema.optional(),
  packageName: z.string().optional(),
  durationMs: nonNegativeMs.optional(),
  get conditions() {
    return z.array(ConditionSchema).optional();
  },
}).superRefine((condition, ctx) => {
  switch (condition.type) {
    case "elementVisible":
    case "elementGone":
      requireField(condition, ctx, "target");
      break;
    case "appInForeground":
    case "appNotInForeground":
      requireField(condition, ctx, "packageName");
      break;
    case "timeElapsed":
      requireField(condition, ctx, "durationMs");
      break;
    case "anyOf":
    case "allOf":
      requireNonEmptyArray(condition, ctx, "conditions");
      break;
  }
});

const SwipePathSchema = z.looseObject({
  startXPct: pct,
  startYPct: pct,
  endXPct: pct,
  endYPct: pct,
  durationMs: nonNegativeMs.optional(),
});

const ScrollRegionSchema = z.looseObject({
  leftPct: pct,
  topPct: pct,
  rightPct: pct,
  bottomPct: pct,
});

const StoreValueSourceSchema = z.looseObject({
  type: nonEmptyString,
  target: TargetSchema.optional(),
  text: z.string().optional(),
}).superRefine((source, ctx) => {
  switch (source.type) {
    case "screen":
      requireField(source, ctx, "target");
      break;
    case "template":
      requireField(source, ctx, "text");
      break;
  }
});

const ActionSchema = z.looseObject({
  type: nonEmptyString,
  target: TargetSchema.optional(),
  message: z.string().optional(),
  speakVoice: z.boolean().optional(),
  showText: z.boolean().optional(),
  packageName: z.string().optional(),
  appName: z.string().optional(),
  delayMs: nonNegativeMs.optional(),
  timeoutMs: nonNegativeMs.optional(),
  durationMs: nonNegativeMs.optional(),
  pressDurationMs: nonNegativeMs.optional(),
  text: z.string().optional(),
  clearFirst: z.boolean().optional(),
  mode: z.string().optional(),
  systemType: z.string().optional(),
  direction: z.string().optional(),
  maxScrolls: z.number().int().positive().optional(),
  scrollDurationMs: nonNegativeMs.optional(),
  settleDelayMs: nonNegativeMs.optional(),
  tapWhenFound: z.boolean().optional(),
  scrollRegion: ScrollRegionSchema.optional(),
  scrollPath: SwipePathSchema.optional(),
  variableName: z.string().optional(),
  copyToClipboard: z.boolean().optional(),
  source: StoreValueSourceSchema.optional(),
  goalId: z.string().optional(),
  startXPct: pct.optional(),
  startYPct: pct.optional(),
  endXPct: pct.optional(),
  endYPct: pct.optional(),
  condition: ConditionSchema.optional(),
  get onTrue() {
    return z.array(ActionSchema).optional();
  },
  get onFalse() {
    return z.array(ActionSchema).optional();
  },
  get actions() {
    return z.array(ActionSchema).optional();
  },
}).superRefine((action, ctx) => {
  switch (action.type) {
    case "tap":
    case "longTap":
      requireField(action, ctx, "target");
      break;
    case "notify":
      requireField(action, ctx, "message");
      break;
    case "launchApp":
      requireField(action, ctx, "packageName");
      break;
    case "delay":
      requireField(action, ctx, "durationMs");
      break;
    case "typeText":
      requireField(action, ctx, "target");
      requireField(action, ctx, "text");
      break;
    case "systemAction":
      requireField(action, ctx, "systemType");
      break;
    case "swipe":
      if (action.target === undefined) {
        requireField(action, ctx, "startXPct");
        requireField(action, ctx, "startYPct");
        requireField(action, ctx, "endXPct");
        requireField(action, ctx, "endYPct");
      }
      break;
    case "scrollTo":
      requireField(action, ctx, "target");
      requireField(action, ctx, "direction");
      break;
    case "storeValue":
      requireField(action, ctx, "source");
      break;
    case "waitFor":
      requireField(action, ctx, "condition");
      break;
    case "conditionBranch":
      requireField(action, ctx, "condition");
      requireField(action, ctx, "onTrue");
      requireField(action, ctx, "onFalse");
      break;
    case "runStep":
      requireField(action, ctx, "goalId");
      break;
  }
});

const ConstraintsSchema = z.looseObject({
  // All fields optional — defaults live in schema.json / App model.
  maxExecutions: z.number().int().nonnegative().optional(),
  cooldownMs: nonNegativeMs.optional(),
  continueOnFailure: z.boolean().optional(),
  enabled: z.boolean().optional(),
  executionMode: z.string().optional(),
  optional: z.boolean().optional(),
  fallbackPolicy: z.string().optional(),
  loopFailurePolicy: z.string().optional(),
  recognitionTimeoutMs: nonNegativeMs.optional(),
  maxRecognitionAttempts: z.number().int().positive().optional(),
});

const GoalSchema = z.looseObject({
  id: nonEmptyString,
  name: nonEmptyString,
  priority: z.number().int().optional(),
  trigger: TriggerSchema,
  action: ActionSchema.optional(),
  actions: z.array(ActionSchema).optional(),
  constraints: ConstraintsSchema.optional(),
});

const InterruptSchema = z.looseObject({
  name: nonEmptyString,
  when: TargetSchema,
  dismiss: TargetSchema,
  enabled: z.boolean().optional(),
});

const TerminationSchema = z.looseObject({
  type: nonEmptyString,
  maxDurationMs: nonNegativeMs.optional(),
  maxIdleMs: nonNegativeMs.optional(),
  goalIds: z.array(nonEmptyString).optional(),
}).superRefine((termination, ctx) => {
  if (termination.type === "timeout") {
    requireField(termination, ctx, "maxDurationMs");
  }
  if (termination.type === "idleTimeout") {
    requireField(termination, ctx, "maxIdleMs");
  }
});

const ScanConfigSchema = z.looseObject({
  idleIntervalMs: nonNegativeMs.optional(),
  activeIntervalMs: nonNegativeMs.optional(),
  fallbackToImageMatch: z.boolean().optional(),
});

const LaunchAppSchema = z.looseObject({
  type: z.literal("launchApp").optional(),
  packageName: nonEmptyString,
  appName: z.string().optional(),
  timeoutMs: nonNegativeMs.optional(),
  delayMs: nonNegativeMs.optional(),
  note: z.string().optional(),
});

export const ReactiveSkillSchema = z.looseObject({
  id: nonEmptyString,
  name: nonEmptyString,
  description: nonEmptyString,
  executionMode: z.string().optional(),
  agentId: z.string().optional(),
  termination: TerminationSchema.optional(),
  launchApp: LaunchAppSchema.optional(),
  interrupts: z.array(InterruptSchema).optional(),
  goals: z.array(GoalSchema).min(1),
  pacingPreset: z.string().optional(),
  scanConfig: ScanConfigSchema.optional(),
  returnToApp: z.boolean().optional(),
});
