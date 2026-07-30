const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createContractValidator,
  pathToString,
} = require("../build/contract-schema-validator.js");
const { schemaForAction } = require("../fixtures/runtime-contract.js");

function skill(action = { type: "notify", message: "hello" }) {
  return {
    id: "test",
    name: "Test",
    description: "test",
    goals: [{ id: "g1", name: "Goal", trigger: { type: "immediate" }, action }],
  };
}

function messages(result) {
  return result.issues.map((issue) => `${pathToString(issue.path)}: ${issue.message}`);
}

test("compiles and validates a schema supplied at runtime", () => {
  const validate = createContractValidator(schemaForAction("notify"));
  assert.deepEqual(validate(skill()), { ok: true, issues: [] });
});

test("reports required fields with focused paths", () => {
  const validate = createContractValidator(schemaForAction("notify"));
  const result = validate(skill({ type: "notify" }));
  assert.equal(result.ok, false);
  assert.match(messages(result).join("\n"), /action\.message: type "notify" requires "message"/);
});

test("collapses unknown discriminator branch noise", () => {
  const validate = createContractValidator(schemaForAction("notify"));
  const result = validate(skill({ type: "futureAction" }));
  const text = messages(result).join("\n");
  assert.match(text, /action: unknown or invalid action type "futureAction"/);
  assert.doesNotMatch(text, /requires "message"|requires "target"/);
});

test("does not misreport a valid parent when a nested selector is invalid", () => {
  const validate = createContractValidator(schemaForAction("notify"));
  const result = validate(skill({ type: "tap", target: { type: "image" } }));
  const text = messages(result).join("\n");
  assert.match(text, /target\.imagePath: type "image" requires "imagePath"/);
  assert.doesNotMatch(text, /unknown or invalid action type "tap"/);
});

test("the current runtime schema determines accepted action types", () => {
  const notifyValidator = createContractValidator(schemaForAction("notify"));
  const delayValidator = createContractValidator(schemaForAction("delay"));

  assert.equal(notifyValidator(skill()).ok, true);
  assert.equal(delayValidator(skill()).ok, false);
  assert.equal(delayValidator(skill({ type: "delay", message: "done" })).ok, true);
});

test("rejects a non-object schema response", () => {
  assert.throws(() => createContractValidator(null), /JSON object/);
});
