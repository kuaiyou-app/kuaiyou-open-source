const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require("node:path");
const http = require("node:http");
const { schemaForAction } = require("../fixtures/runtime-contract.js");

const SERVER_ENTRY = path.join(__dirname, "..", "build", "index.js");

let client;
let transport;
let schemaServer;

function validSkillJson(id = "test-123") {
  return JSON.stringify({
    id,
    name: "Test Skill",
    description: "A test skill",
    termination: { type: "allGoalsDone" },
    goals: [
      {
        id: "g1",
        name: "Goal 1",
        trigger: { type: "immediate" },
        action: { type: "notify", message: "hello" },
      },
    ],
  });
}

before(async () => {
  schemaServer = http.createServer((req, res) => {
    if (req.url === "/api/mcp/schema") {
      res.writeHead(200, { "Content-Type": "application/schema+json" });
      res.end(JSON.stringify(schemaForAction("notify")));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => schemaServer.listen(0, "127.0.0.1", resolve));
  const { port } = schemaServer.address();

  transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      KUAIYOU_DEVICE_URL: `http://127.0.0.1:${port}`,
      KUAIYOU_DEVICE_IP: "",
    },
  });
  client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await new Promise((resolve) => schemaServer?.close(resolve));
});

test("tools/list exposes core and debug tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  for (const required of [
    "capture_screenshot",
    "get_kuaiyou_schema",
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

test("get_kuaiyou_schema returns the current App contract", async () => {
  const res = await client.callTool({ name: "get_kuaiyou_schema", arguments: {} });
  assert.notEqual(res.isError, true);
  assert.deepEqual(JSON.parse(res.content[0].text), schemaForAction("notify"));
});

test("validate_kuaiyou_skill accepts a valid skill", async () => {
  const skillJson = validSkillJson();
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
  // The runtime schema should produce field-level diagnostics, not a parse error.
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

test("push_reactive_skill rejects a skillId that differs from skillJson.id", async () => {
  await assert.rejects(
    client.callTool({
      name: "push_reactive_skill",
      arguments: { skillId: "argument-id", skillJson: validSkillJson("payload-id") },
    }),
    /does not match skillJson\.id/
  );
});

test("stop_skill validates its optional skillId", async () => {
  await assert.rejects(
    client.callTool({ name: "stop_skill", arguments: { skillId: "../invalid" } }),
    /skillId must be valid/
  );
});

test("get_execution_log validates limit bounds", async () => {
  for (const limit of [0, -1, 1.5, 1001]) {
    await assert.rejects(
      client.callTool({ name: "get_execution_log", arguments: { skillId: "valid", limit } }),
      /limit must be an integer between 1 and 1000/
    );
  }
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
  const noDeviceTransport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: { ...process.env, KUAIYOU_DEVICE_URL: "", KUAIYOU_DEVICE_IP: "" },
  });
  const noDeviceClient = new Client(
    { name: "no-device-probe", version: "1.0.0" },
    { capabilities: {} }
  );
  await noDeviceClient.connect(noDeviceTransport);
  try {
    for (const name of [
      "list_skills",
      "get_ui_tree",
      "capture_screenshot",
      "get_kuaiyou_schema",
      "validate_kuaiyou_skill",
    ]) {
      const arguments_ = name === "validate_kuaiyou_skill" ? { skillJson: validSkillJson() } : {};
      const res = await noDeviceClient.callTool({ name, arguments: arguments_ });
      const text = (res.content || []).map((c) => c.text || "").join("\n");
      assert.equal(res.isError, true, `${name} should error without a device address`);
      assert.match(text, /needs a device address/, `${name}: ${text}`);
      assert.doesNotMatch(text, /not available yet on this App build/, `${name}: ${text}`);
    }
  } finally {
    await noDeviceClient.close();
  }
});

test("invalid device URL configuration is reported as an MCP parameter error", async () => {
  const invalidTransport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: { ...process.env, KUAIYOU_DEVICE_URL: "file:///tmp/device", KUAIYOU_DEVICE_IP: "" },
  });
  const invalidClient = new Client(
    { name: "invalid-config-probe", version: "1.0.0" },
    { capabilities: {} }
  );
  await invalidClient.connect(invalidTransport);
  try {
    await assert.rejects(
      invalidClient.callTool({ name: "list_skills", arguments: {} }),
      /Invalid device address configuration.*http:\/\/ or https:\/\//
    );
  } finally {
    await invalidClient.close();
  }
});

// Regression: a device that answered and refused (401/403/404/4xx) used to be
// reported as "Failed to ... over the LAN HTTP channel. Check that: MCP switch
// is on; same network; ...", which sent people debugging their Wi-Fi when the
// real cause was a rejected skill or a stale pairing code.
//
// Uses a throwaway local server rather than a public host so the assertion does
// not depend on the internet being reachable.
test("device rejections are not reported as channel failures", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", errorMessage: "无障碍服务未开启" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      KUAIYOU_DEVICE_URL: "",
      KUAIYOU_DEVICE_IP: `127.0.0.1:${port}`,
      KUAIYOU_MCP_PAIRING_CODE: "000000",
    },
  });
  const probe = new Client({ name: "reject-probe", version: "1.0.0" }, { capabilities: {} });
  await probe.connect(transport);
  try {
    const res = await probe.callTool({ name: "get_ui_tree", arguments: {} });
    const text = (res.content || []).map((c) => c.text || "").join("\n");
    assert.equal(res.isError, true);
    assert.match(text, /The device refused to fetch the screen nodes \(HTTP 503\)/, text);
    assert.match(text, /accessibility permission is off/, text);
    assert.doesNotMatch(text, /phone and computer are on the same network/, text);
  } finally {
    await probe.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("mutating device tools are serialized through the real MCP handler", async () => {
  let active = 0;
  let maxActive = 0;
  const paths = [];
  const server = http.createServer(async (req, res) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    paths.push(req.url);
    await new Promise((resolve) => setTimeout(resolve, 30));
    active -= 1;
    res.writeHead(200, { "Content-Type": "application/json", Connection: "close" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const probeTransport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: { ...process.env, KUAIYOU_DEVICE_URL: `http://127.0.0.1:${port}`, KUAIYOU_DEVICE_IP: "" },
  });
  const probe = new Client({ name: "lock-probe", version: "1.0.0" }, { capabilities: {} });
  await probe.connect(probeTransport);
  try {
    const [run, remove] = await Promise.all([
      probe.callTool({ name: "run_skill", arguments: { skillId: "serial-test" } }),
      probe.callTool({ name: "delete_skill", arguments: { skillId: "serial-test" } }),
    ]);
    assert.notEqual(run.isError, true);
    assert.notEqual(remove.isError, true);
    assert.equal(maxActive, 1);
    assert.deepEqual(paths.sort(), ["/api/mcp/run", "/api/mcp/skills/delete"].sort());
  } finally {
    await probe.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
