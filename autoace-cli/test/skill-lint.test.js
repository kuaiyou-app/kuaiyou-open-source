const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateSkillPayload } = require("../build/skill-lint.js");
const { createContractValidator } = require("../build/contract-schema-validator.js");
const { schemaForAction } = require("../fixtures/runtime-contract.js");

function baseSkill() {
  return {
    id: "s1",
    name: "n",
    description: "d",
    termination: { type: "allGoalsDone" },
    goals: [
      {
        id: "g1",
        name: "Goal",
        trigger: { type: "immediate" },
        action: { type: "delay", durationMs: 100 },
        constraints: { maxExecutions: 1, cooldownMs: 0, continueOnFailure: false, enabled: true },
      },
    ],
  };
}

test("rejects forbidden local-only action aliases", () => {
  for (const action of [
    { type: "readText", target: { type: "text", text: "x" }, variableName: "v" },
    { type: "setClipboard", text: "x" },
    { type: "askAgent", question: "?" },
  ]) {
    const skill = baseSkill();
    skill.goals[0].action = action;
    const result = validateSkillPayload(skill);
    assert.equal(result.ok, false, action.type);
    assert.ok(result.errors.some((error) => error.includes(action.type)), result.errors.join(";"));
  }
});

test("rejects dangling afterGoal and detects cycles", () => {
  const skill = baseSkill();
  skill.goals.push({
    id: "g2",
    name: "g2",
    trigger: { type: "afterGoal", goalId: "missing" },
    action: { type: "delay", durationMs: 1 },
  });
  let result = validateSkillPayload(skill);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("missing")));

  const cyclic = baseSkill();
  cyclic.goals = [
    {
      id: "a",
      name: "a",
      trigger: { type: "afterGoal", goalId: "b" },
      action: { type: "delay", durationMs: 1 },
    },
    {
      id: "b",
      name: "b",
      trigger: { type: "afterGoal", goalId: "a" },
      action: { type: "delay", durationMs: 1 },
    },
  ];
  result = validateSkillPayload(cyclic);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("cycle")));
});

test("applies a contract validator supplied by the running client", () => {
  const validator = createContractValidator(schemaForAction("notify"));
  const skill = baseSkill();
  skill.goals[0].action = { type: "futureAction" };

  const result = validateSkillPayload(skill, validator);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /unknown or invalid action type "futureAction"/);
});

test("warns on infinite REPEAT without timeout termination", () => {
  const skill = baseSkill();
  skill.goals[0].constraints = {
    maxExecutions: 0,
    executionMode: "REPEAT",
    cooldownMs: 1000,
    continueOnFailure: true,
    enabled: true,
  };
  delete skill.termination;
  const result = validateSkillPayload(skill);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((warning) => /forever|unlimited/i.test(warning)));
});

test("business lint does not reject forEach payloads before device validation", () => {
  const variants = [
    {
      type: "fixedTargets",
      targets: [
        {
          displayName: "row 1",
          selector: { type: "text", text: "row 1", matchMode: "CONTAINS" },
        },
      ],
    },
    {
      type: "matchRule",
      item: { type: "text", text: "openai", matchMode: "CONTAINS" },
      excludeTexts: ["广告"],
      findTimeoutMs: 15000,
    },
  ];

  for (const source of variants) {
    const skill = baseSkill();
    skill.goals[0].action = {
      type: "forEach",
      source,
      actions: [{ type: "notify", message: "{{item}}", speakVoice: false }],
    };
    const result = validateSkillPayload(skill);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  }
});

test("business lint does not classify storeValue sources as policy errors", () => {
  const cases = [
    { type: "screen", target: { type: "text", text: "row 1" } },
    { type: "template", text: "{{item}}" },
  ];

  for (const source of cases) {
    const skill = baseSkill();
    skill.goals[0].action = {
      type: "storeValue",
      source,
      variableName: "value",
    };
    const result = validateSkillPayload(skill);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  }
});
