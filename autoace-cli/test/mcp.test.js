const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const { schemaForAction } = require("../fixtures/runtime-contract.js");

process.env.KUAIYOU_CONFIG_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), "autoace-cfg-"));

const SERVER_ENTRY = path.join(__dirname, "..", "build", "index.js");

function probeEnv(extra = {}) {
  return { ...process.env, KUAIYOU_CONFIG_DIR: "", ...extra };
}

let client;
let transport;
let schemaServer;
let schemaServerPort;

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
    if (req.url === "/api/mcp/pair" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", paired: true, pairedAt: Date.now() }));
      return;
    }
    if (req.url === "/api/mcp/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "kuaiyou-mcp" }));
      return;
    }
    if (req.url === "/api/mcp/schema") {
      res.writeHead(200, { "Content-Type": "application/schema+json" });
      res.end(JSON.stringify(schemaForAction("notify")));
      return;
    }
    if (req.url === "/api/mcp/prompts") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: 1, skill: { id: "skill.generate" }, planOutlines: [] }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => schemaServer.listen(0, "127.0.0.1", resolve));
  schemaServerPort = schemaServer.address().port;

  transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      KUAIYOU_DEVICE_URL: `http://127.0.0.1:${schemaServerPort}`,
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
    "get_kuaiyou_prompts",
    "observe_screen",
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

test("get_kuaiyou_prompts returns the App generation rules payload", async () => {
  const res = await client.callTool({ name: "get_kuaiyou_prompts", arguments: {} });
  assert.notEqual(res.isError, true);
  assert.equal(JSON.parse(res.content[0].text).status, "ok");
});

test("get_kuaiyou_prompts 404 tells the Agent to upgrade the App", async () => {
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

  const probe = new Client({ name: "prompts-404-probe", version: "1.0.0" }, { capabilities: {} });
  const probeTransport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: probeEnv({
      KUAIYOU_DEVICE_URL: `http://127.0.0.1:${port}`,
      KUAIYOU_DEVICE_IP: "",
      KUAIYOU_MCP_PAIRING_CODE: "000000",
    }),
  });
  await probe.connect(probeTransport);
  try {
    const res = await probe.callTool({ name: "get_kuaiyou_prompts", arguments: {} });
    const text = (res.content || []).map((c) => c.text || "").join("\n");
    assert.equal(res.isError, true);
    assert.match(text, /upgrade|升级/);
    assert.match(text, /Do not use any prompt text bundled/);
  } finally {
    await probe.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("pair_device synthesizes device context from user connectionInfo paste", async () => {
  const res = await client.callTool({
    name: "pair_device",
    arguments: {
      connectionInfo:
        `地址：127.0.0.1:${schemaServerPort}\n配对码：000000\n\n设备：TestBrand · Android 14 · 1080x2400 · App 9.9.9\n`,
    },
  });
  assert.notEqual(res.isError, true);
  const text = res.content[0].text;
  assert.match(text, /配对成功/);
  assert.match(text, /TestBrand/);
  assert.match(text, /Android 14/);
  assert.match(text, /1080x2400/);
  assert.match(text, /App：9\.9\.9/);
  assert.match(text, /capture_screenshot/);
  assert.match(text, /plans_deploy/);
  assert.match(text, /展示给用户/);
  assert.match(text, new RegExp(`地址：127\\.0\\.0\\.1:${schemaServerPort}`));
  assert.match(text, /已保存到本机/);
});

test("pair_device persists the target so a new MCP process works without env", async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoace-persist-"));
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === "/api/mcp/pair" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", paired: true }));
      return;
    }
    if (req.url === "/api/mcp/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/api/mcp/schema") {
      res.writeHead(200, { "Content-Type": "application/schema+json" });
      res.end(JSON.stringify(schemaForAction("notify")));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const env = {
    ...process.env,
    KUAIYOU_CONFIG_DIR: configDir,
    KUAIYOU_DEVICE_URL: "",
    KUAIYOU_DEVICE_IP: "",
    KUAIYOU_MCP_PAIRING_CODE: "",
    KUAIYOU_MCP_TOKEN: "",
  };

  const firstTransport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env,
  });
  const first = new Client({ name: "persist-first", version: "1.0.0" }, { capabilities: {} });
  await first.connect(firstTransport);
  try {
    const paired = await first.callTool({
      name: "pair_device",
      arguments: {
        connectionInfo: `地址：127.0.0.1:${port}\n配对码：424242\n`,
      },
    });
    assert.notEqual(paired.isError, true, paired.content?.[0]?.text);
    assert.match(paired.content[0].text, /已保存到本机/);
  } finally {
    await first.close();
  }

  const saved = JSON.parse(await fs.readFile(path.join(configDir, "device.json"), "utf8"));
  assert.equal(saved.baseUrl, `http://127.0.0.1:${port}`);
  assert.equal(saved.pairingCode, "424242");

  const secondTransport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env,
  });
  const second = new Client({ name: "persist-second", version: "1.0.0" }, { capabilities: {} });
  await second.connect(secondTransport);
  try {
    const schema = await second.callTool({ name: "get_kuaiyou_schema", arguments: {} });
    assert.notEqual(schema.isError, true, schema.content?.[0]?.text);
    assert.deepEqual(JSON.parse(schema.content[0].text), schemaForAction("notify"));
    assert.ok(hits.includes("GET /api/mcp/schema"));
  } finally {
    await second.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(configDir, { recursive: true, force: true });
  }
});

test("pair_device connectionInfo overrides stale env port for pair and later tools", async () => {
  const hits = [];
  const liveServer = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === "/api/mcp/pair" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", paired: true, pairedAt: 42 }));
      return;
    }
    if (req.url === "/api/mcp/schema") {
      res.writeHead(200, { "Content-Type": "application/schema+json" });
      res.end(JSON.stringify(schemaForAction("notify")));
      return;
    }
    res.writeHead(404).end("{}");
  });
  await new Promise((resolve) => liveServer.listen(0, "127.0.0.1", resolve));
  const livePort = liveServer.address().port;

  // Stale env points at a closed/unused port; connectionInfo must win.
  const stalePort = livePort === 38665 ? 38666 : 38665;
  const overrideTransport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: probeEnv({
      KUAIYOU_DEVICE_URL: "",
      KUAIYOU_DEVICE_IP: `127.0.0.1:${stalePort}`,
      KUAIYOU_MCP_PAIRING_CODE: "111111",
    }),
  });
  const overrideClient = new Client(
    { name: "override-client", version: "1.0.0" },
    { capabilities: {} }
  );
  await overrideClient.connect(overrideTransport);
  try {
    const pairRes = await overrideClient.callTool({
      name: "pair_device",
      arguments: {
        connectionInfo: `地址：127.0.0.1:${livePort}\n配对码：999999\n\n设备：OverrideBrand · Android 15 · 720x1600 · App 3.0.0\n`,
      },
    });
    assert.notEqual(pairRes.isError, true, pairRes.content?.[0]?.text);
    const pairText = pairRes.content[0].text;
    assert.match(pairText, new RegExp(`POST http://127\\.0\\.0\\.1:${livePort}/api/mcp/pair`));
    assert.match(pairText, new RegExp(`地址：127\\.0\\.0\\.1:${livePort}`));
    assert.doesNotMatch(pairText, new RegExp(String(stalePort)));
    assert.ok(hits.includes("POST /api/mcp/pair"));

    const schemaRes = await overrideClient.callTool({
      name: "get_kuaiyou_schema",
      arguments: {},
    });
    assert.notEqual(schemaRes.isError, true, schemaRes.content?.[0]?.text);
    assert.ok(hits.includes("GET /api/mcp/schema"));
  } finally {
    await overrideClient.close();
    await new Promise((resolve) => liveServer.close(resolve));
  }
});

test("pair_device structured host/port/code override paste and env", async () => {
  const hits = [];
  const liveServer = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const auth = req.headers.authorization || "";
    hits.push(`auth:${auth}`);
    if (req.url === "/api/mcp/pair" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", paired: true }));
      return;
    }
    res.writeHead(404).end("{}");
  });
  await new Promise((resolve) => liveServer.listen(0, "127.0.0.1", resolve));
  const livePort = liveServer.address().port;

  const structuredTransport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: probeEnv({
      KUAIYOU_DEVICE_URL: "",
      KUAIYOU_DEVICE_IP: "127.0.0.1:1",
      KUAIYOU_MCP_PAIRING_CODE: "000000",
    }),
  });
  const structuredClient = new Client(
    { name: "structured-client", version: "1.0.0" },
    { capabilities: {} }
  );
  await structuredClient.connect(structuredTransport);
  try {
    const res = await structuredClient.callTool({
      name: "pair_device",
      arguments: {
        connectionInfo: "地址：127.0.0.1:2\n配对码：111111\n设备：PasteBrand · Android 10 · 1x1 · App 1.0.0\n",
        host: "127.0.0.1",
        port: String(livePort),
        code: "777777",
        deviceLabel: "StructBrand · Android 16 · 1080x1920 · App 4.0.0",
      },
    });
    assert.notEqual(res.isError, true, res.content?.[0]?.text);
    const text = res.content[0].text;
    assert.match(text, /StructBrand/);
    assert.doesNotMatch(text, /PasteBrand/);
    assert.match(text, new RegExp(`POST http://127\\.0\\.0\\.1:${livePort}/api/mcp/pair`));
    assert.ok(hits.includes("POST /api/mcp/pair"));
    assert.ok(hits.includes("auth:Bearer 777777"));
  } finally {
    await structuredClient.close();
    await new Promise((resolve) => liveServer.close(resolve));
  }
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

test("push_reactive_skill accepts the same .json file path as validate_kuaiyou_skill", async () => {
  const skillId = "file-path-skill";
  const skillJson = validSkillJson(skillId);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoace-skill-"));
  const filePath = path.join(tmpDir, `${skillId}.json`);
  await fs.writeFile(filePath, skillJson);

  const hits = [];
  let importedBody = "";
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === "/api/mcp/pair" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", paired: true }));
      return;
    }
    if (req.url === "/api/mcp/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/api/mcp/schema") {
      res.writeHead(200, { "Content-Type": "application/schema+json" });
      res.end(JSON.stringify(schemaForAction("notify")));
      return;
    }
    if (req.url === "/api/mcp/import" && req.method === "POST") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        importedBody = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, pendingConfirm: true }));
      });
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
    env: probeEnv({ KUAIYOU_DEVICE_URL: `http://127.0.0.1:${port}`, KUAIYOU_DEVICE_IP: "" }),
  });
  const probe = new Client({ name: "file-path-probe", version: "1.0.0" }, { capabilities: {} });
  await probe.connect(probeTransport);
  try {
    const validated = await probe.callTool({
      name: "validate_kuaiyou_skill",
      arguments: { skillJson: filePath },
    });
    assert.notEqual(validated.isError, true, validated.content?.[0]?.text);
    const pushed = await probe.callTool({
      name: "push_reactive_skill",
      arguments: { skillId, skillJson: filePath },
    });
    assert.notEqual(pushed.isError, true, pushed.content?.[0]?.text);
    assert.match(pushed.content[0].text, /Successfully deployed/);
    assert.ok(hits.includes("POST /api/mcp/import"));
    assert.equal(JSON.parse(importedBody).id, skillId);
  } finally {
    await probe.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

test("observe_screen returns a screenshot plus compact interactive nodes", async () => {
  const tree = {
    packageName: "com.example.app",
    bounds: "[0,0][1080,2400]",
    children: [
      {
        text: "去签到",
        resourceId: "id/checkin",
        clickable: true,
        className: "android.widget.Button",
        bounds: "[100,200][400,280]",
      },
    ],
  };
  const server = http.createServer((req, res) => {
    if (req.url === "/api/mcp/pair" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", paired: true }));
      return;
    }
    if (req.url === "/api/mcp/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/api/mcp/ui_tree") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(tree));
      return;
    }
    if (req.url === "/api/mcp/screenshot") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG_1X1);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const probeTransport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: probeEnv({ KUAIYOU_DEVICE_URL: `http://127.0.0.1:${port}`, KUAIYOU_DEVICE_IP: "" }),
  });
  const probe = new Client({ name: "observe-probe", version: "1.0.0" }, { capabilities: {} });
  await probe.connect(probeTransport);
  try {
    const res = await probe.callTool({ name: "observe_screen", arguments: {} });
    assert.notEqual(res.isError, true, res.content?.[0]?.text || res.content?.[1]?.text);
    const image = res.content.find((c) => c.type === "image");
    const text = res.content.find((c) => c.type === "text");
    assert.ok(image, "expected screenshot");
    assert.equal(image.mimeType, "image/png");
    assert.match(text.text, /去签到/);
    assert.match(text.text, /package: com\.example\.app/);
    assert.match(text.text, /Prefer this over get_ui_tree/);
    assert.doesNotMatch(text.text, /android\.widget\.FrameLayout/);
  } finally {
    await probe.close();
    await new Promise((resolve) => server.close(resolve));
  }
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
    env: probeEnv({ KUAIYOU_DEVICE_URL: "", KUAIYOU_DEVICE_IP: "" }),
  });
  const noDeviceClient = new Client(
    { name: "no-device-probe", version: "1.0.0" },
    { capabilities: {} }
  );
  await noDeviceClient.connect(noDeviceTransport);
  try {
    for (const name of [
      "list_skills",
      "observe_screen",
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
    env: probeEnv({ KUAIYOU_DEVICE_URL: "file:///tmp/device", KUAIYOU_DEVICE_IP: "" }),
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

  const probe = new Client({ name: "reject-probe", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: probeEnv({
      KUAIYOU_DEVICE_URL: "",
      KUAIYOU_DEVICE_IP: `127.0.0.1:${port}`,
      KUAIYOU_MCP_PAIRING_CODE: "000000",
    }),
  });
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
    env: probeEnv({ KUAIYOU_DEVICE_URL: `http://127.0.0.1:${port}`, KUAIYOU_DEVICE_IP: "" }),
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
    assert.ok(paths.includes("/api/mcp/health"));
    assert.ok(paths.includes("/api/mcp/pair"));
    assert.ok(paths.includes("/api/mcp/run"));
    assert.ok(paths.includes("/api/mcp/skills/delete"));
    assert.deepEqual(
      paths.filter((p) => p !== "/api/mcp/pair" && p !== "/api/mcp/health").sort(),
      ["/api/mcp/run", "/api/mcp/skills/delete"].sort()
    );
  } finally {
    await probe.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("unreachable device is reported as disconnected and does not call business routes", async () => {
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const { port } = closed.address();
  await new Promise((resolve) => closed.close(resolve));

  const probe = new Client({ name: "disconnect-probe", version: "1.0.0" }, { capabilities: {} });
  const probeTransport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: probeEnv({
      KUAIYOU_DEVICE_URL: "",
      KUAIYOU_DEVICE_IP: `127.0.0.1:${port}`,
      KUAIYOU_MCP_PAIRING_CODE: "000000",
    }),
  });
  await probe.connect(probeTransport);
  try {
    const res = await probe.callTool({ name: "capture_screenshot", arguments: {} });
    const text = (res.content || []).map((c) => c.text || "").join("\n");
    assert.equal(res.isError, true);
    assert.match(text, /断开/);
    assert.match(text, /重新配对/);
    assert.match(text, /pair_device/);
    assert.doesNotMatch(text, /phone and computer are on the same network/);
    assert.doesNotMatch(text, /pairing code was rejected/);
  } finally {
    await probe.close();
  }
});

test("HTTP 401 after a live health probe is pairing-code, not disconnect", async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === "/api/mcp/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "kuaiyou-mcp" }));
      return;
    }
    if (req.url === "/api/mcp/pair" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", paired: true }));
      return;
    }
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", errorMessage: "unauthorized" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const probe = new Client({ name: "auth-probe", version: "1.0.0" }, { capabilities: {} });
  const probeTransport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: probeEnv({
      KUAIYOU_DEVICE_URL: `http://127.0.0.1:${port}`,
      KUAIYOU_DEVICE_IP: "",
      KUAIYOU_MCP_PAIRING_CODE: "000000",
    }),
  });
  await probe.connect(probeTransport);
  try {
    const res = await probe.callTool({ name: "get_ui_tree", arguments: {} });
    const text = (res.content || []).map((c) => c.text || "").join("\n");
    assert.equal(res.isError, true);
    assert.match(text, /HTTP 401/);
    assert.match(text, /pairing code was rejected/);
    assert.doesNotMatch(text, /断开/);
    assert.doesNotMatch(text, /重新配对/);
    assert.ok(hits.includes("GET /api/mcp/health"));
    assert.ok(hits.includes("GET /api/mcp/ui_tree"));
  } finally {
    await probe.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
