const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  PHONE_CONFIRM_NOTICE,
  asBool,
  bodyIndicatesPendingConfirm,
  formatDebugLoopText,
  isAlreadyRunningFailure,
  isRetryableConfirmFailure,
  parseSkillStatus,
  resolveWaitTimeoutMs,
  startThenWaitForSkill,
  summarizeExecutionLog,
  waitForSkillTerminal,
} = require("../build/skill-debug.js");

test("parseSkillStatus reads running / success flags", () => {
  assert.equal(parseSkillStatus(JSON.stringify({ running: true })).phase, "running");
  assert.equal(parseSkillStatus(JSON.stringify({ running: false, success: true })).phase, "succeeded");
  assert.equal(
    parseSkillStatus(JSON.stringify({ running: false, success: false, errorMessage: "missed" })).phase,
    "failed"
  );
  assert.equal(parseSkillStatus(JSON.stringify({ running: false, success: false })).reason, undefined);
});

test("parseSkillStatus reads nested execution state and envelope status=ok", () => {
  assert.equal(parseSkillStatus(JSON.stringify({ status: "ok", running: true })).phase, "running");
  assert.equal(
    parseSkillStatus(JSON.stringify({ lastExecution: { state: "FAILED", error: "gone" } })).phase,
    "failed"
  );
  assert.equal(parseSkillStatus(JSON.stringify({ execution: { state: "COMPLETED" } })).phase, "succeeded");
  assert.equal(
    parseSkillStatus(JSON.stringify({ pendingConfirm: true, running: false })).phase,
    "idle"
  );
});

test("resolveWaitTimeoutMs clamps and rejects junk", () => {
  assert.equal(resolveWaitTimeoutMs(undefined), 90_000);
  assert.equal(resolveWaitTimeoutMs(5000), 5000);
  assert.throws(() => resolveWaitTimeoutMs(12.5), /integer/);
  assert.throws(() => resolveWaitTimeoutMs(50), /between/);
  assert.throws(() => resolveWaitTimeoutMs(200_000), /between/);
});

test("asBool only accepts true/false-like values", () => {
  assert.equal(asBool(true), true);
  assert.equal(asBool("true"), true);
  assert.equal(asBool(false), false);
  assert.equal(asBool("yes"), undefined);
});

test("pending-confirm and already-running heuristics", () => {
  assert.equal(bodyIndicatesPendingConfirm(JSON.stringify({ pendingConfirm: true })), true);
  assert.equal(bodyIndicatesPendingConfirm(JSON.stringify({ ok: true })), false);
  assert.equal(isAlreadyRunningFailure(409, "skill is already running"), true);
  assert.equal(isRetryableConfirmFailure(404, ""), true);
  assert.equal(isRetryableConfirmFailure(409, "pendingConfirm=true 未确认"), true);
  assert.equal(isRetryableConfirmFailure(409, "already running"), false);
  assert.equal(isRetryableConfirmFailure(401, "pendingConfirm"), false);
});

test("summarizeExecutionLog keeps the tail", () => {
  assert.equal(summarizeExecutionLog("   "), "(no log lines)");
  assert.equal(summarizeExecutionLog("abc"), "abc");
  assert.equal(summarizeExecutionLog("x".repeat(50), 10), "x".repeat(10));
});

test("waitForSkillTerminal returns succeeded after running", async () => {
  const statuses = [
    JSON.stringify({ running: true }),
    JSON.stringify({ running: false, success: true }),
  ];
  const result = await waitForSkillTerminal({
    getStatus: async () => ({ ok: true, text: statuses.shift() }),
    getLog: async () => ({ ok: true, text: "goal g1 done" }),
    timeoutMs: 1000,
    pollIntervalMs: 0,
    sleep: async () => {},
  });
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.logSummary, "goal g1 done");
  assert.equal(result.screenshot, undefined);
});

test("waitForSkillTerminal attaches screenshot on failure", async () => {
  const result = await waitForSkillTerminal({
    getStatus: async () => ({
      ok: true,
      text: JSON.stringify({ running: false, success: false, error: "no node" }),
    }),
    getLog: async () => ({ ok: true, text: "ERROR tap missed" }),
    getScreenshot: async () => ({ data: "aaa", mimeType: "image/png" }),
    timeoutMs: 1000,
    pollIntervalMs: 0,
    sleep: async () => {},
  });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.screenshot, { data: "aaa", mimeType: "image/png" });
  assert.match(result.logSummary, /tap missed/);
});

test("waitForSkillTerminal times out while still running", async () => {
  let now = 0;
  const result = await waitForSkillTerminal({
    getStatus: async () => ({ ok: true, text: JSON.stringify({ running: true }) }),
    getLog: async () => ({ ok: true, text: "still going" }),
    timeoutMs: 5,
    pollIntervalMs: 5,
    sleep: async (ms) => {
      now += ms;
    },
    now: () => now,
  });
  assert.equal(result.outcome, "timeout");
});

test("startThenWaitForSkill retries confirm failures then waits", async () => {
  let starts = 0;
  const statuses = [JSON.stringify({ running: true }), JSON.stringify({ state: "COMPLETED" })];
  const result = await startThenWaitForSkill({
    start: async () => {
      starts += 1;
      if (starts === 1) {
        return { ok: false, status: 404, body: "not confirmed", logs: "run 404\n" };
      }
      return { ok: true, status: 200, body: JSON.stringify({ started: true }), logs: "run 200\n" };
    },
    getStatus: async () => ({ ok: true, text: statuses.shift() || JSON.stringify({ state: "COMPLETED" }) }),
    getLog: async () => ({ ok: true, text: "done" }),
    timeoutMs: 1000,
    pollIntervalMs: 0,
    sleep: async () => {},
    waitForConfirm: true,
  });
  assert.equal(result.kind, "waited");
  assert.equal(result.pendingConfirmWaited, true);
  assert.equal(result.waited.outcome, "succeeded");
  assert.equal(starts, 2);
});

test("formatDebugLoopText is honest about phone confirmation", () => {
  const text = formatDebugLoopText({
    skillId: "open_wechat",
    outcome: "failed",
    elapsedMs: 1200,
    logSummary: "missed 签到",
    screenshotAttached: true,
    pendingConfirmWaited: true,
  });
  assert.match(text, /finished: failed/);
  assert.match(text, /不能跳过 App 确认框/);
  assert.match(text, /no developer-mode auto-confirm/);
  assert.match(text, /screenshot of the phone/);
  assert.ok(text.includes(PHONE_CONFIRM_NOTICE.split("\n")[0]));
  assert.doesNotMatch(text, /already skipped|免确认已生效/);
});
