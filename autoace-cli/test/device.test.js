const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

process.env.KUAIYOU_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "autoace-cfg-"));
const {
  DeviceDisconnectedError,
  HttpStatusError,
  ResponseTooLargeError,
  TimeoutError,
  addressToBaseUrl,
  clearDevicePairingSession,
  clearSessionDeviceOverride,
  ensureDevicePaired,
  ensureDeviceReachable,
  httpGetBuffer,
  httpGetText,
  isDeviceUnreachable,
  persistPairedDevice,
  readPersistedDevice,
  clearPersistedDevice,
  resetDeviceConfigCache,
  resolveDeviceBaseUrl,
  setSessionDeviceOverride,
  withDeviceLock,
} = require("../build/device.js");

test("withDeviceLock serializes overlapping operations", async () => {
  const events = [];
  const makeTask = (label, delay) => async () => {
    events.push(`start:${label}`);
    await new Promise((r) => setTimeout(r, delay));
    events.push(`end:${label}`);
    return label;
  };

  // Start B while A is still "running"; the lock must run them one at a time.
  const a = withDeviceLock(makeTask("A", 30));
  const b = withDeviceLock(makeTask("B", 5));
  const results = await Promise.all([a, b]);

  assert.deepEqual(results, ["A", "B"]);
  assert.deepEqual(events, ["start:A", "end:A", "start:B", "end:B"]);
});

test("withDeviceLock keeps the chain alive after a rejected task", async () => {
  const failing = withDeviceLock(async () => {
    throw new Error("boom");
  });
  await assert.rejects(failing, /boom/);

  // A subsequent task must still run despite the prior rejection.
  const ok = await withDeviceLock(async () => "recovered");
  assert.equal(ok, "recovered");
});

test("sniffImageMime detects png and jpeg", () => {
  const { sniffImageMime } = require("../build/device.js");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(sniffImageMime(png), "image/png");
  assert.equal(sniffImageMime(jpeg), "image/jpeg");
});

test("HttpStatusError carries the status code", () => {
  const { HttpStatusError } = require("../build/device.js");
  const err = new HttpStatusError(404, "Not Found");
  assert.equal(err.status, 404);
  assert.equal(err.name, "HttpStatusError");
  assert.match(err.message, /HTTP 404 Not Found/);
  assert.ok(err instanceof Error);
});

test("resolveDeviceBaseUrl prefers an explicit URL and preserves IP compatibility", () => {
  clearSessionDeviceOverride();
  clearPersistedDevice();
  resetDeviceConfigCache();
  assert.equal(
    resolveDeviceBaseUrl({
      KUAIYOU_DEVICE_URL: "https://device.local:8443/",
      KUAIYOU_DEVICE_IP: "192.0.2.1:8080",
    }),
    "https://device.local:8443"
  );
  assert.equal(resolveDeviceBaseUrl({ KUAIYOU_DEVICE_IP: "192.0.2.1" }), "http://192.0.2.1:8080");
  assert.equal(resolveDeviceBaseUrl({ KUAIYOU_DEVICE_IP: "192.0.2.1:9000" }), "http://192.0.2.1:9000");
  assert.equal(resolveDeviceBaseUrl({}), undefined);
});

test("resolveDeviceBaseUrl rejects unsafe or ambiguous addresses", () => {
  clearSessionDeviceOverride();
  clearPersistedDevice();
  assert.throws(() => resolveDeviceBaseUrl({ KUAIYOU_DEVICE_URL: "file:///tmp/device" }), /http/);
  assert.throws(() => resolveDeviceBaseUrl({ KUAIYOU_DEVICE_URL: "http://user:pass@device" }), /credentials/);
  assert.throws(() => resolveDeviceBaseUrl({ KUAIYOU_DEVICE_IP: "http://device" }), /host/);
  assert.throws(() => resolveDeviceBaseUrl({ KUAIYOU_DEVICE_IP: "2001:db8::1" }), /bracket/);
});

test("session device override wins over env for resolveDeviceBaseUrl", () => {
  clearSessionDeviceOverride();
  clearPersistedDevice();
  setSessionDeviceOverride({ baseUrl: "http://127.0.0.1:42091" });
  try {
    assert.equal(
      resolveDeviceBaseUrl({ KUAIYOU_DEVICE_IP: "127.0.0.1:38665" }),
      "http://127.0.0.1:42091"
    );
    assert.equal(addressToBaseUrl("192.168.0.4:9"), "http://192.168.0.4:9");
  } finally {
    clearSessionDeviceOverride();
  }
});

test("persisted pair_device record wins over env and survives a cleared session", () => {
  clearSessionDeviceOverride();
  clearPersistedDevice();
  const saved = persistPairedDevice({
    baseUrl: "http://192.0.2.8:41899",
    pairingCode: "654321",
  });
  assert.equal(saved.ok, true);
  try {
    assert.equal(resolveDeviceBaseUrl({ KUAIYOU_DEVICE_IP: "127.0.0.1:1" }), "http://192.0.2.8:41899");
    assert.equal(readPersistedDevice().pairingCode, "654321");
    setSessionDeviceOverride({ baseUrl: "http://127.0.0.1:9" });
    assert.equal(resolveDeviceBaseUrl({}), "http://127.0.0.1:9");
    clearSessionDeviceOverride();
    assert.equal(resolveDeviceBaseUrl({}), "http://192.0.2.8:41899");
  } finally {
    clearSessionDeviceOverride();
    clearPersistedDevice();
  }
});

test("HTTP helpers reject response bodies above their configured limit", async () => {
  await assert.rejects(
    httpGetText("data:text/plain,abcdef", 1000, 3),
    (error) => error instanceof ResponseTooLargeError && error.limitBytes === 3
  );
  await assert.rejects(
    httpGetBuffer("data:application/octet-stream;base64,AQIDBAUG", 1000, 4),
    (error) => error instanceof ResponseTooLargeError && error.limitBytes === 4
  );
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    server.close(() => resolve());
  });
}

test("isDeviceUnreachable distinguishes transport failures from HTTP 401/404", () => {
  assert.equal(isDeviceUnreachable(new TimeoutError("timed out")), true);
  assert.equal(isDeviceUnreachable(new DeviceDisconnectedError("http://127.0.0.1:1")), true);
  assert.equal(isDeviceUnreachable(new HttpStatusError(401, "Unauthorized")), false);
  assert.equal(isDeviceUnreachable(new HttpStatusError(404, "Not Found")), false);
  assert.equal(isDeviceUnreachable(new HttpStatusError(429, "Too Many Requests")), false);
  const refused = new Error("connect ECONNREFUSED");
  refused.code = "ECONNREFUSED";
  assert.equal(isDeviceUnreachable(refused), true);
  const wrapped = new TypeError("fetch failed");
  wrapped.cause = refused;
  assert.equal(isDeviceUnreachable(wrapped), true);
});

test("ensureDeviceReachable passes when health returns 200 status=ok without Bearer", async () => {
  clearSessionDeviceOverride();
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    assert.equal(req.headers.authorization, undefined);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "kuaiyou-mcp" }));
  });
  await listen(server);
  const { port } = server.address();
  try {
    await ensureDeviceReachable(`http://127.0.0.1:${port}`);
    assert.deepEqual(hits, ["GET /api/mcp/health"]);
  } finally {
    await closeServer(server);
    clearSessionDeviceOverride();
  }
});

test("ensureDeviceReachable does not treat HTTP 401 as disconnect", async () => {
  clearSessionDeviceOverride();
  const server = http.createServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "error", errorMessage: "unauthorized" }));
  });
  await listen(server);
  const { port } = server.address();
  try {
    await ensureDeviceReachable(`http://127.0.0.1:${port}`);
  } finally {
    await closeServer(server);
    clearSessionDeviceOverride();
  }
});

test("ensureDeviceReachable timeout/refused is disconnect, skips pair, and clears pair cache", async () => {
  clearSessionDeviceOverride();
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
    res.writeHead(404).end();
  });
  await listen(server);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await ensureDeviceReachable(baseUrl);
    const first = await ensureDevicePaired(baseUrl);
    assert.equal(first.reusedSession, false);
    const reused = await ensureDevicePaired(baseUrl);
    assert.equal(reused.reusedSession, true);
  } finally {
    await closeServer(server);
  }

  // Health TTL can skip a probe for a few seconds after success; wait it out so
  // a dead endpoint is discovered instead of reusedSession hiding the outage.
  await new Promise((r) => setTimeout(r, 3100));
  await assert.rejects(
    () => ensureDeviceReachable(baseUrl, 200),
    (err) => err instanceof DeviceDisconnectedError
  );
  await assert.rejects(() => ensureDevicePaired(baseUrl, 200));
  clearDevicePairingSession();
});

test("ensureDeviceReachable hanging health is disconnect and does not follow up with pair", async () => {
  clearSessionDeviceOverride();
  const hits = [];
  const server = http.createServer((req) => {
    hits.push(req.url);
  });
  await listen(server);
  const { port } = server.address();
  try {
    await assert.rejects(
      () => ensureDeviceReachable(`http://127.0.0.1:${port}`, 80),
      (err) => err instanceof DeviceDisconnectedError
    );
    assert.deepEqual(hits, ["/api/mcp/health"]);
  } finally {
    await closeServer(server);
    clearSessionDeviceOverride();
  }
});
