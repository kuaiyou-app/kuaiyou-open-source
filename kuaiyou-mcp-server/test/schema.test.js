const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ReactiveSkillSchema } = require("../build/reactive-skill-schema.js");

// A minimal but realistic skill matching the structure of the shipped skills.
function validSkill() {
  return {
    id: "test-skill",
    name: "Test",
    description: "desc",
    agentId: "agent_life",
    termination: { type: "allGoalsDone" },
    goals: [
      {
        id: "g1",
        name: "Goal",
        priority: 5,
        trigger: { type: "immediate" },
        actions: [{ type: "notify", message: "hi", speakVoice: false }],
        constraints: {
          maxExecutions: 1,
          cooldownMs: 0,
          continueOnFailure: false,
          enabled: true,
        },
      },
    ],
  };
}

function mutate(fn) {
  const skill = validSkill();
  fn(skill);
  return skill;
}

function issuePaths(result) {
  return result.error.issues.map((i) => i.path.join("."));
}

test("accepts a realistic skill", () => {
  const result = ReactiveSkillSchema.safeParse(validSkill());
  assert.ok(result.success, JSON.stringify(result.error?.issues));
});

test("accepts maxExecutions 0 (REPEAT mode semantics: unlimited)", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => {
      s.goals[0].constraints.maxExecutions = 0;
      s.goals[0].constraints.executionMode = "REPEAT";
    })
  );
  assert.ok(result.success, JSON.stringify(result.error?.issues));
});

test("rejects an empty goals array", () => {
  const result = ReactiveSkillSchema.safeParse(mutate((s) => (s.goals = [])));
  assert.equal(result.success, false);
  assert.ok(issuePaths(result).includes("goals"));
});

test("rejects a goal without trigger, with a nested path", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => delete s.goals[0].trigger)
  );
  assert.equal(result.success, false);
  assert.ok(issuePaths(result).includes("goals.0.trigger"));
});

test("rejects elementVisible trigger without target", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => (s.goals[0].trigger = { type: "elementVisible" }))
  );
  assert.equal(result.success, false);
  assert.ok(issuePaths(result).includes("goals.0.trigger.target"));
});

test("rejects allOf trigger with an empty triggers array", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => (s.goals[0].trigger = { type: "allOf", triggers: [] }))
  );
  assert.equal(result.success, false);
  assert.ok(issuePaths(result).includes("goals.0.trigger.triggers"));
});

test("validates nested triggers inside allOf recursively", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate(
      (s) =>
        (s.goals[0].trigger = {
          type: "allOf",
          triggers: [{ type: "elementVisible" }],
        })
    )
  );
  assert.equal(result.success, false);
  assert.ok(issuePaths(result).includes("goals.0.trigger.triggers.0.target"));
});

test("rejects tap action without target", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => (s.goals[0].actions = [{ type: "tap" }]))
  );
  assert.equal(result.success, false);
  assert.ok(issuePaths(result).includes("goals.0.actions.0.target"));
});

test("rejects notify action without message", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => (s.goals[0].actions = [{ type: "notify" }]))
  );
  assert.equal(result.success, false);
  assert.ok(issuePaths(result).includes("goals.0.actions.0.message"));
});

test("rejects launchApp action without packageName", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => (s.goals[0].actions = [{ type: "launchApp" }]))
  );
  assert.equal(result.success, false);
  assert.ok(issuePaths(result).includes("goals.0.actions.0.packageName"));
});

test("validates conditionBranch branches recursively", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate(
      (s) =>
        (s.goals[0].actions = [
          {
            type: "conditionBranch",
            condition: {
              type: "elementVisible",
              target: { type: "text", text: "OK" },
            },
            onTrue: [{ type: "notify" }],
            onFalse: [{ type: "delay", durationMs: 100 }],
            timeoutMs: 1000,
          },
        ])
    )
  );
  assert.equal(result.success, false);
  assert.ok(issuePaths(result).includes("goals.0.actions.0.onTrue.0.message"));
});

test("accepts unknown action and trigger types (forward compatibility)", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => {
      s.goals[0].trigger = { type: "futureTrigger", whatever: 1 };
      s.goals[0].actions = [{ type: "futureAction", novel: true }];
    })
  );
  assert.ok(result.success, JSON.stringify(result.error?.issues));
});

test("rejects text target without text and id target without viewId", () => {
  const r1 = ReactiveSkillSchema.safeParse(
    mutate(
      (s) =>
        (s.goals[0].actions = [{ type: "tap", target: { type: "text" } }])
    )
  );
  assert.ok(issuePaths(r1).includes("goals.0.actions.0.target.text"));

  const r2 = ReactiveSkillSchema.safeParse(
    mutate((s) => (s.goals[0].actions = [{ type: "tap", target: { type: "id" } }]))
  );
  assert.ok(issuePaths(r2).includes("goals.0.actions.0.target.viewId"));
});

test("accepts constraints missing enabled (defaults live in schema/App)", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => delete s.goals[0].constraints.enabled)
  );
  assert.ok(result.success, JSON.stringify(result.error?.issues));
});

test("accepts skill without termination (defaults to allGoalsDone on device)", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => delete s.termination)
  );
  assert.ok(result.success, JSON.stringify(result.error?.issues));
});

test("accepts top-level launchApp", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => {
      s.launchApp = { type: "launchApp", packageName: "com.example.app" };
    })
  );
  assert.ok(result.success, JSON.stringify(result.error?.issues));
});

test("accepts storeValue with screen source", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate(
      (s) =>
        (s.goals[0].actions = [
          {
            type: "storeValue",
            source: { type: "screen", target: { type: "text", text: "Hi" } },
            variableName: "t",
          },
        ])
    )
  );
  assert.ok(result.success, JSON.stringify(result.error?.issues));
});

test("rejects storeValue screen source without target", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => (s.goals[0].actions = [{ type: "storeValue", source: { type: "screen" } }]))
  );
  assert.equal(result.success, false);
});

test("rejects timeout termination without maxDurationMs", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => (s.termination = { type: "timeout" }))
  );
  assert.equal(result.success, false);
  assert.ok(issuePaths(result).includes("termination.maxDurationMs"));
});

test("rejects negative or fractional millisecond fields", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => (s.goals[0].constraints.cooldownMs = -1))
  );
  assert.equal(result.success, false);

  const fractional = ReactiveSkillSchema.safeParse(
    mutate((s) => (s.goals[0].actions[0].delayMs = 1.5))
  );
  assert.equal(fractional.success, false);
});

test("rejects Pct coordinates outside [0, 1]", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate(
      (s) =>
        (s.goals[0].actions = [
          { type: "swipe", startXPct: 82, startYPct: 0.5, endXPct: 0.5, endYPct: 0.3 },
        ])
    )
  );
  assert.equal(result.success, false);
  assert.ok(issuePaths(result).includes("goals.0.actions.0.startXPct"));
});

test("preserves unknown extra fields (loose objects)", () => {
  const result = ReactiveSkillSchema.safeParse(
    mutate((s) => {
      s.futureTopLevelField = { nested: [1, 2, 3] };
      s.goals[0].futureGoalField = "x";
    })
  );
  assert.ok(result.success, JSON.stringify(result.error?.issues));
  assert.deepEqual(result.data.futureTopLevelField, { nested: [1, 2, 3] });
  assert.equal(result.data.goals[0].futureGoalField, "x");
});

// Regression: these fields used to be plain z.string(), so the CLI reported
// "Validation successful" for values the App rejects at import time. A skill
// with constraints.executionMode = "ONCE" round-tripped to the phone only to
// come back as: GoalExecutionMode does not contain element with name 'ONCE'.
test("rejects closed-set values the device would refuse", () => {
  const cases = [
    ["constraints.executionMode", (s) => (s.goals[0].constraints.executionMode = "ONCE")],
    ["constraints.fallbackPolicy", (s) => (s.goals[0].constraints.fallbackPolicy = "MAYBE")],
    ["constraints.loopFailurePolicy", (s) => (s.goals[0].constraints.loopFailurePolicy = "RETRY")],
    ["skill executionMode", (s) => (s.executionMode = "PARALLEL")],
    ["pacingPreset", (s) => (s.pacingPreset = "TURBO")],
    // The schema used to document TESTED / PENDING_TEST, which the App has never had.
    ["debugStatus", (s) => (s.debugStatus = "TESTED")],
    ["debugStatus", (s) => (s.debugStatus = "PENDING_TEST")],
    ["systemType", (s) => (s.goals[0].actions[0] = { type: "systemAction", systemType: "EXIT" })],
  ];
  for (const [label, mutate] of cases) {
    const skill = validSkill();
    mutate(skill);
    const result = ReactiveSkillSchema.safeParse(skill);
    assert.equal(result.success, false, `expected ${label} to be rejected`);
  }
});

test("accepts every documented value for the closed sets", () => {
  const ok = (mutate) => {
    const skill = validSkill();
    mutate(skill);
    const result = ReactiveSkillSchema.safeParse(skill);
    assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  };

  for (const v of ["SINGLE", "REPEAT"]) ok((s) => (s.goals[0].constraints.executionMode = v));
  for (const v of ["AUTO_ONLY", "ALLOW_PROMPT", "STRICT"]) ok((s) => (s.goals[0].constraints.fallbackPolicy = v));
  for (const v of ["SKIP_ROUND", "ABORT", "RETRY_AFTER_COOLDOWN"])
    ok((s) => (s.goals[0].constraints.loopFailurePolicy = v));
  for (const v of ["FAST", "STANDARD", "CAREFUL"]) ok((s) => (s.pacingPreset = v));
  for (const v of ["SUCCESS", "PARTIAL_SUCCESS", "INCOMPLETE"]) ok((s) => (s.debugStatus = v));
  for (const v of ["UP", "DOWN", "LEFT", "RIGHT"])
    ok((s) => (s.goals[0].actions[0] = { type: "scrollTo", direction: v, target: { type: "text", text: "x" } }));
  for (const v of ["DEFAULT", "PASTE", "WECHAT_SPECIAL"])
    ok((s) => (s.goals[0].actions[0] = { type: "typeText", text: "hi", mode: v, target: { type: "text", text: "x" } }));
  // SEQUENTIAL is the App's legacy alias for REACTIVE and must stay accepted.
  for (const v of ["REACTIVE", "SEQUENTIAL"]) ok((s) => (s.executionMode = v));
});

test("enum errors name the field and list the allowed values", () => {
  const skill = validSkill();
  skill.goals[0].constraints.executionMode = "ONCE";
  const result = ReactiveSkillSchema.safeParse(skill);
  assert.equal(result.success, false);
  const message = result.error.issues.map((i) => i.message).join("\n");
  assert.match(message, /constraints\.executionMode/);
  assert.match(message, /SINGLE \| REPEAT/);
  assert.match(message, /ONCE/);
});
