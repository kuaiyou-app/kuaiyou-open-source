const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

process.env.KUAIYOU_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "autoace-cfg-"));
const {
  clearDeviceSchemaCache,
  fetchDeviceContractValidator,
  PLAN_SCHEMA_PATH,
} = require("../build/device-schema.js");
const { clearDevicePairingSession } = require("../build/device.js");

function schemaRequiring(field) {
  return JSON.stringify({
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: [field],
    properties: { [field]: { type: "string" } },
  });
}

test("fetches the App schema every time and reuses compilation only for identical content", async () => {
  clearDeviceSchemaCache();
  clearDevicePairingSession();
  let body = schemaRequiring("id");
  let schemaRequests = 0;
  let pairRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/api/mcp/pair" && req.method === "POST") {
      pairRequests += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", paired: true, pairedAt: Date.now() }));
      return;
    }
    schemaRequests += 1;
    assert.equal(req.url, "/api/mcp/schema");
    res.writeHead(200, { "Content-Type": "application/schema+json" });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const first = await fetchDeviceContractValidator(baseUrl);
    const second = await fetchDeviceContractValidator(baseUrl);
    assert.equal(pairRequests, 1);
    assert.equal(schemaRequests, 2);
    assert.equal(first, second);
    assert.equal(first({ id: "x" }).ok, true);

    body = schemaRequiring("name");
    const third = await fetchDeviceContractValidator(baseUrl);
    assert.equal(schemaRequests, 3);
    assert.notEqual(third, second);
    assert.equal(third({ id: "x" }).ok, false);
    assert.equal(third({ name: "x" }).ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rejects invalid JSON returned by the schema endpoint", async () => {
  clearDeviceSchemaCache();
  clearDevicePairingSession();
  const server = http.createServer((req, res) => {
    if (req.url === "/api/mcp/pair") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", paired: true }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("not-json");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    await assert.rejects(
      fetchDeviceContractValidator(`http://127.0.0.1:${port}`),
      /invalid schema JSON/
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("skill and plan schema caches are independent endpoints", async () => {
  clearDeviceSchemaCache();
  clearDevicePairingSession();
  const hits = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/api/mcp/pair" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", paired: true }));
      return;
    }
    hits.push(req.url);
    if (req.url === "/api/mcp/schema") {
      res.writeHead(200, { "Content-Type": "application/schema+json" });
      res.end(schemaRequiring("skillField"));
      return;
    }
    if (req.url === PLAN_SCHEMA_PATH) {
      res.writeHead(200, { "Content-Type": "application/schema+json" });
      res.end(schemaRequiring("planField"));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const skill = await fetchDeviceContractValidator(baseUrl);
    const plan = await fetchDeviceContractValidator(baseUrl, PLAN_SCHEMA_PATH);
    assert.equal(skill({ skillField: "x" }).ok, true);
    assert.equal(skill({ planField: "x" }).ok, false);
    assert.equal(plan({ planField: "x" }).ok, true);
    assert.equal(plan({ skillField: "x" }).ok, false);
    assert.deepEqual(hits.filter((u) => u !== "/api/mcp/pair").sort(), [
      "/api/mcp/plans/schema",
      "/api/mcp/schema",
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
