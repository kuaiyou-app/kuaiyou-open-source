const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require("node:path");

const SERVER_ENTRY = path.join(__dirname, "..", "build", "index.js");

let client;
let transport;

before(async () => {
  // No KUAIYOU_DEVICE_IP => device tools short-circuit with a "needs a device
  // address" error. These tests only exercise the protocol, validation, and
  // argument-checking layers, all of which run before any device I/O.
  transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: { ...process.env, KUAIYOU_DEVICE_IP: "" },
  });
  client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
});

test("tools/list exposes core and debug tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  for (const required of [
    "capture_screenshot",
    "get_ui_tree",
    "push_reactive_skill",
    "validate_kuaiyou_skill",
    "list_skills",
    "run_skill",
    "stop_skill",
    "get_skill_status",
    "get_execution_log",
    "delete_skill",
  ]) {
    assert.ok(names.includes(required), `missing tool ${required}`);
  }
});

test("validate_kuaiyou_skill accepts a valid skill", async () => {
  const skillJson = JSON.stringify({
    id: "test-123",
    name: "Test Skill",
    description: "A test skill",
    agentId: "agent_life",
    termination: { type: "allGoalsDone" },
    goals: [
      {
        id: "g1",
        name: "Goal 1",
        priority: 5,
        trigger: { type: "immediate" },
        actions: [{ type: "notify", message: "hello", speakVoice: false }],
        constraints: {
          maxExecutions: 1,
          cooldownMs: 0,
          continueOnFailure: false,
          enabled: true,
        },
      },
    ],
  });
  const res = await client.callTool({
    name: "validate_kuaiyou_skill",
    arguments: { skillJson },
  });
  assert.notEqual(res.isError, true);
  assert.match(res.content[0].text, /Validation successful/);
});

test("validate_kuaiyou_skill reports field-level errors for missing fields", async () => {
  const skillJson = JSON.stringify({ id: "x" }); // valid JSON, missing required fields
  const res = await client.callTool({
    name: "validate_kuaiyou_skill",
    arguments: { skillJson },
  });
  assert.equal(res.isError, true);
  // Regression guard for the zod v4 issues[] fix: must not surface as
  // "Invalid JSON format", and must name the missing fields.
  assert.match(res.content[0].text, /Validation failed with errors/);
  assert.match(res.content[0].text, /name/);
  assert.doesNotMatch(res.content[0].text, /Invalid JSON format/);
});

test("validate_kuaiyou_skill rejects malformed JSON", async () => {
  const res = await client.callTool({
    name: "validate_kuaiyou_skill",
    arguments: { skillJson: "{ not json" },
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Invalid JSON format/);
});

test("push_reactive_skill rejects a skillId with a shell metacharacter", async () => {
  await assert.rejects(
    client.callTool({
      name: "push_reactive_skill",
      arguments: { skillId: "a; id", skillJson: "{}" },
    }),
    /skillId must match/
  );
});

test("push_reactive_skill rejects a skillId with path traversal", async () => {
  await assert.rejects(
    client.callTool({
      name: "push_reactive_skill",
      arguments: { skillId: "../evil", skillJson: "{}" },
    }),
    /skillId must match/
  );
});

test("push_reactive_skill rejects missing arguments", async () => {
  await assert.rejects(
    client.callTool({
      name: "push_reactive_skill",
      arguments: { skillId: "only-id" },
    }),
    /required/
  );
});

test("push_reactive_skill rejects forbidden action before deploy", async () => {
  const skillJson = JSON.stringify({
    id: "bad",
    name: "Bad",
    description: "d",
    goals: [
      {
        id: "g1",
        name: "g",
        trigger: { type: "immediate" },
        action: { type: "readText", target: { type: "text", text: "x" }, variableName: "v" },
      },
    ],
  });
  const res = await client.callTool({
    name: "push_reactive_skill",
    arguments: { skillId: "bad", skillJson },
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /readText/);
  assert.match(res.content[0].text, /Refusing to deploy/);
});

test("unknown tool returns a method-not-found error", async () => {
  await assert.rejects(
    client.callTool({ name: "does_not_exist", arguments: {} }),
    /Unknown tool/
  );
});

// The server advertises its version as a literal in src/index.ts, which is easy
// to forget when bumping package.json. Keep the two in lockstep.
test("advertised server version matches package.json", async () => {
  const pkg = require("../package.json");
  const info = client.getServerVersion();
  assert.equal(info.version, pkg.version);
  assert.equal(info.name, pkg.name);
});

// Regression: a timeout used to be reported as "not available yet on this App
// build", which blamed the App instead of the connection. Without
// KUAIYOU_DEVICE_IP the tool must ask for an address instead.
test("device tools report a missing address rather than an unsupported build", async () => {
  for (const name of ["list_skills", "get_ui_tree", "capture_screenshot"]) {
    const res = await client.callTool({ name, arguments: {} });
    const text = (res.content || []).map((c) => c.text || "").join("\n");
    assert.equal(res.isError, true, `${name} should error without a device address`);
    assert.match(text, /needs a device address/, `${name}: ${text}`);
    assert.doesNotMatch(text, /not available yet on this App build/, `${name}: ${text}`);
  }
});
