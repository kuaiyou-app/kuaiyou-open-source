const { test } = require("node:test");
const assert = require("node:assert/strict");
const { withDeviceLock, TimeoutError } = require("../build/device.js");

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

test("getPackageName falls back to the shipping applicationId", () => {
  const { getPackageName, DEFAULT_APP_PACKAGE } = require("../build/device.js");
  const previous = process.env.KUAIYOU_APP_PACKAGE;
  try {
    delete process.env.KUAIYOU_APP_PACKAGE;
    assert.equal(getPackageName(), "com.kuaiyou.automator.clicker");
    assert.equal(getPackageName(), DEFAULT_APP_PACKAGE);

    // Blank / whitespace-only overrides must not produce an empty path segment.
    process.env.KUAIYOU_APP_PACKAGE = "   ";
    assert.equal(getPackageName(), DEFAULT_APP_PACKAGE);
  } finally {
    if (previous === undefined) delete process.env.KUAIYOU_APP_PACKAGE;
    else process.env.KUAIYOU_APP_PACKAGE = previous;
  }
});

test("getPackageName accepts suffixed test builds and rejects injection", () => {
  const { getPackageName } = require("../build/device.js");
  const previous = process.env.KUAIYOU_APP_PACKAGE;
  try {
    process.env.KUAIYOU_APP_PACKAGE = "com.kuaiyou.automator.clicker.test";
    assert.equal(getPackageName(), "com.kuaiyou.automator.clicker.test");

    // Anything that could escape the /sdcard/Android/data/<pkg>/files path or
    // smuggle extra adb arguments must be rejected outright.
    for (const bad of [
      "../../etc",
      "com.kuaiyou/../../root",
      "com.kuaiyou clicker",
      "com.kuaiyou;rm -rf /",
      "com.kuaiyou/files",
      "nodots",
      "com..kuaiyou",
      ".com.kuaiyou",
    ]) {
      process.env.KUAIYOU_APP_PACKAGE = bad;
      assert.throws(() => getPackageName(), /Invalid KUAIYOU_APP_PACKAGE/, `expected rejection: ${bad}`);
    }
  } finally {
    if (previous === undefined) delete process.env.KUAIYOU_APP_PACKAGE;
    else process.env.KUAIYOU_APP_PACKAGE = previous;
  }
});
