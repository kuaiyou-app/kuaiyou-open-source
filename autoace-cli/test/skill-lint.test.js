const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateSkillPayload } = require("../build/skill-lint.js");

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

test("rejects readText / setClipboard / askAgent", () => {
  for (const action of [
    { type: "readText", target: { type: "text", text: "x" }, variableName: "v" },
    { type: "setClipboard", text: "x" },
    { type: "askAgent", question: "?" },
  ]) {
    const skill = baseSkill();
    skill.goals[0].action = action;
    const r = validateSkillPayload(skill);
    assert.equal(r.ok, false, action.type);
    assert.ok(r.errors.some((e) => e.includes(action.type)), r.errors.join(";"));
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
  let r = validateSkillPayload(skill);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("missing")));

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
  r = validateSkillPayload(cyclic);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("cycle")));
});

test("warns on unknown action type with suggestion", () => {
  const skill = baseSkill();
  skill.goals[0].action = { type: "Tap", target: { type: "text", text: "x" } };
  const r = validateSkillPayload(skill);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /Tap/.test(w) && /tap/.test(w)));
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
  const r = validateSkillPayload(skill);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /forever|unlimited/i.test(w)));
});
