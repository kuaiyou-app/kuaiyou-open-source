const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");

process.env.KUAIYOU_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "autoace-cfg-"));

const SERVER_ENTRY = path.join(__dirname, "..", "build", "index.js");

/** Minimal draft-07 schema stand-in — never ship the real learning-plan.schema.json in-repo. */
function mockPlanSchema() {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: ["id", "name", "scenarioId", "phases"],
    properties: {
      id: { type: "string", minLength: 1 },
      name: { type: "string", minLength: 1 },
      scenarioId: { type: "string", minLength: 1 },
      goal: { type: "string" },
      phases: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["id", "nodes"],
          properties: {
            id: { type: "string" },
            nodes: {
              type: "array",
              items: {
                type: "object",
                required: ["id"],
                properties: { id: { type: "string" } },
              },
            },
          },
        },
      },
    },
  };
}

function validPlanJson(id = "plan-demo") {
  return JSON.stringify({
    id,
    name: "Demo Plan",
    scenarioId: "scenario-1",
    goal: "Learn something",
    phases: [{ id: "p1", nodes: [{ id: "n1" }] }],
  });
}

let client;
let transport;
let mockServer;
let lastDeployBody = "";
let routes = [];

before(async () => {
  mockServer = http.createServer((req, res) => {
    routes.push(`${req.method} ${req.url}`);
    if (req.url === "/api/mcp/pair" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", paired: true, pairedAt: Date.now() }));
      return;
    }
    if (req.url === "/api/mcp/plans/schema" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/schema+json" });
      res.end(JSON.stringify(mockPlanSchema()));
      return;
    }
    if (req.url === "/api/mcp/plans" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify([
          {
            id: "plan-demo",
            name: "Demo Plan",
            goal: "Learn something",
            phaseCount: 1,
            nodeCount: 1,
            updatedAt: 0,
          },
        ])
      );
      return;
    }
    if (req.url === "/api/mcp/plans/plan-demo" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(validPlanJson());
      return;
    }
    if (req.url === "/api/mcp/plans/validate" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", valid: true }));
      });
      return;
    }
    if (req.url === "/api/mcp/plans" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        lastDeployBody = body;
        const parsed = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            planId: parsed.id,
            planName: parsed.name,
            updated: false,
            pendingConfirm: true,
          })
        );
      });
      return;
    }
    if (req.url === "/api/mcp/plans/delete" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", deleted: JSON.parse(body).planId }));
      });
      return;
    }
    // Skill schema still present so other tools are unaffected if accidentally called.
    if (req.url === "/api/mcp/schema") {
      res.writeHead(200, { "Content-Type": "application/schema+json" });
      res.end(JSON.stringify({ type: "object" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const { port } = mockServer.address();

  transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      KUAIYOU_DEVICE_URL: `http://127.0.0.1:${port}`,
      KUAIYOU_DEVICE_IP: "",
      KUAIYOU_MCP_PAIRING_CODE: "123456",
    },
  });
  client = new Client({ name: "plan-test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await new Promise((resolve) => mockServer?.close(resolve));
});

test("tools/list exposes plans_* tools", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const required of [
    "plans_schema",
    "plans_list",
    "plans_get",
    "plans_validate",
    "plans_deploy",
    "plans_delete",
  ]) {
    assert.ok(names.includes(required), `missing tool ${required}`);
  }
});

test("plans_schema returns the device plan contract (not a repo mirror)", async () => {
  const res = await client.callTool({ name: "plans_schema", arguments: {} });
  assert.notEqual(res.isError, true);
  assert.deepEqual(JSON.parse(res.content[0].text), mockPlanSchema());
  assert.ok(routes.some((r) => r === "GET /api/mcp/plans/schema"));
});

test("plans_list and plans_get hit the §3 list/get routes", async () => {
  const list = await client.callTool({ name: "plans_list", arguments: {} });
  assert.notEqual(list.isError, true);
  assert.equal(JSON.parse(list.content[0].text)[0].id, "plan-demo");

  const got = await client.callTool({ name: "plans_get", arguments: { planId: "plan-demo" } });
  assert.notEqual(got.isError, true);
  assert.equal(JSON.parse(got.content[0].text).id, "plan-demo");
});

test("plans_get rejects an unsafe planId", async () => {
  await assert.rejects(
    client.callTool({ name: "plans_get", arguments: { planId: "../evil" } }),
    /planId must match/
  );
});

test("plans_validate accepts a schema-valid plan and posts device validate", async () => {
  const res = await client.callTool({
    name: "plans_validate",
    arguments: { planJson: validPlanJson() },
  });
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  assert.match(res.content[0].text, /Validation successful/);
  assert.ok(routes.some((r) => r === "POST /api/mcp/plans/validate"));
});

test("plans_validate rejects a plan missing required fields", async () => {
  const res = await client.callTool({
    name: "plans_validate",
    arguments: { planJson: JSON.stringify({ id: "x" }) },
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Validation failed/);
  assert.match(res.content[0].text, /name/);
});

test("plans_deploy posts LearningPlan JSON and surfaces pendingConfirm", async () => {
  const res = await client.callTool({
    name: "plans_deploy",
    arguments: { planJson: validPlanJson("plan-deploy-1") },
  });
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  assert.match(res.content[0].text, /pendingConfirm/);
  assert.match(res.content[0].text, /plan-deploy-1/);
  const body = JSON.parse(lastDeployBody);
  assert.equal(body.id, "plan-deploy-1");
  assert.equal(body.scenarioId, "scenario-1");
});

test("plans_deploy refuses invalid JSON before contacting the device", async () => {
  const before = routes.length;
  const res = await client.callTool({
    name: "plans_deploy",
    arguments: { planJson: "{ not json" },
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Refusing to deploy/);
  assert.equal(
    routes.slice(before).filter((r) => r === "POST /api/mcp/plans").length,
    0
  );
});

test("plans_delete posts { planId }", async () => {
  const res = await client.callTool({
    name: "plans_delete",
    arguments: { planId: "plan-demo" },
  });
  assert.notEqual(res.isError, true, res.content?.[0]?.text);
  assert.match(res.content[0].text, /plan-demo/);
});

test("plans tools report missing address rather than unsupported build", async () => {
  const noDeviceTransport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: { ...process.env, KUAIYOU_DEVICE_URL: "", KUAIYOU_DEVICE_IP: "" },
  });
  const noDeviceClient = new Client(
    { name: "no-device-plan-probe", version: "1.0.0" },
    { capabilities: {} }
  );
  await noDeviceClient.connect(noDeviceTransport);
  try {
    for (const name of ["plans_schema", "plans_list", "plans_validate"]) {
      const arguments_ = name === "plans_validate" ? { planJson: validPlanJson() } : {};
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

test("plans_* 404 is reported as App build lacking the route", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/mcp/pair" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", paired: true }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const probeTransport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      KUAIYOU_DEVICE_URL: `http://127.0.0.1:${port}`,
      KUAIYOU_DEVICE_IP: "",
      KUAIYOU_MCP_PAIRING_CODE: "000000",
    },
  });
  const probe = new Client({ name: "plan-404-probe", version: "1.0.0" }, { capabilities: {} });
  await probe.connect(probeTransport);
  try {
    const res = await probe.callTool({ name: "plans_list", arguments: {} });
    const text = (res.content || []).map((c) => c.text || "").join("\n");
    assert.equal(res.isError, true);
    assert.match(text, /not available yet on this App build/, text);
  } finally {
    await probe.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
