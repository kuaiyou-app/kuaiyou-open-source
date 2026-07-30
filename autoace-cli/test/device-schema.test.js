const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  clearDeviceSchemaCache,
  fetchDeviceContractValidator,
} = require("../build/device-schema.js");

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
  let body = schemaRequiring("id");
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
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
    assert.equal(requests, 2);
    assert.equal(first, second);
    assert.equal(first({ id: "x" }).ok, true);

    body = schemaRequiring("name");
    const third = await fetchDeviceContractValidator(baseUrl);
    assert.equal(requests, 3);
    assert.notEqual(third, second);
    assert.equal(third({ id: "x" }).ok, false);
    assert.equal(third({ name: "x" }).ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rejects invalid JSON returned by the schema endpoint", async () => {
  clearDeviceSchemaCache();
  const server = http.createServer((_req, res) => {
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
