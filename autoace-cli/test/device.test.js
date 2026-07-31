const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  ResponseTooLargeError,
  addressToBaseUrl,
  clearSessionDeviceOverride,
  httpGetBuffer,
  httpGetText,
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
  assert.throws(() => resolveDeviceBaseUrl({ KUAIYOU_DEVICE_URL: "file:///tmp/device" }), /http/);
  assert.throws(() => resolveDeviceBaseUrl({ KUAIYOU_DEVICE_URL: "http://user:pass@device" }), /credentials/);
  assert.throws(() => resolveDeviceBaseUrl({ KUAIYOU_DEVICE_IP: "http://device" }), /host/);
  assert.throws(() => resolveDeviceBaseUrl({ KUAIYOU_DEVICE_IP: "2001:db8::1" }), /bracket/);
});

test("session device override wins over env for resolveDeviceBaseUrl", () => {
  clearSessionDeviceOverride();
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
