const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  clearDeviceSchemaCache,
  fetchDeviceContractValidator,
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
