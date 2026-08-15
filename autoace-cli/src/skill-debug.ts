/**
 * Debug-loop helpers for run_skill / push_reactive_skill.
 *
 * Polls the existing App routes (status + logs + screenshot). This is not a
 * parallel tool surface, and it does not skip the phone confirmation dialog.
 */

export const DEBUG_WAIT_DEFAULT_MS = 90_000;
export const DEBUG_WAIT_MAX_MS = 180_000;
export const DEBUG_WAIT_MIN_MS = 1_000;
export const DEBUG_POLL_INTERVAL_MS = 400;
export const DEBUG_LOG_LIMIT = 100;
export const DEBUG_LOG_MAX_CHARS = 4000;

export const PHONE_CONFIRM_NOTICE =
  "仍须在手机上点确认；本 CLI 不能跳过 App 确认框（当前通道没有「开发者模式免确认」）。正在等待你确认，然后等到技能结束或失败。\n" +
  "Phone confirmation is still required. This CLI cannot skip the App dialog (no developer-mode auto-confirm on this channel). Waiting until you tap Confirm, then until the skill stops or fails.";

export type SkillPhase = "idle" | "running" | "succeeded" | "failed" | "unknown";

export type ParsedSkillStatus = {
  phase: SkillPhase;
  reason?: string;
  pendingConfirm?: boolean;
  raw: unknown;
};

export type DebugOutcome = "succeeded" | "failed" | "stopped" | "timeout" | "disconnected" | "error";

export type DeviceGetResult =
  | { ok: true; text: string }
  | { ok: false; logs: string; status?: number; disconnected?: boolean };

export type DevicePostResult = {
  ok: boolean;
  status: number;
  body: string;
  logs: string;
  disconnected?: boolean;
};

export type FailureScreenshot = { data: string; mimeType: string };

const RUNNING_BOOL_KEYS = ["running", "isRunning", "executing", "isExecuting", "started", "active"];
const SUCCESS_BOOL_KEYS = ["success", "lastSuccess", "succeeded"];
const ERROR_STRING_KEYS = ["error", "errorMessage", "reason", "failureReason", "message"];
const STATE_KEYS = ["state", "phase", "executionState", "runState"];
const NESTED_KEYS = ["data", "result", "execution", "lastExecution", "lastResult"];

const FAIL_STATE = /^(failed|fail|error|crashed|aborted|cancelled|canceled)$/i;
const SUCCESS_STATE = /^(completed|complete|done|success|succeeded|finished|terminated)$/i;
const RUNNING_STATE = /^(running|executing|active|started|in_progress|in-progress)$/i;
const IDLE_STATE = /^(idle|stopped|none|ready)$/i;

export function asBool(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

export function resolveWaitTimeoutMs(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return DEBUG_WAIT_DEFAULT_MS;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`timeoutMs must be an integer between ${DEBUG_WAIT_MIN_MS} and ${DEBUG_WAIT_MAX_MS}`);
  }
  if (n < DEBUG_WAIT_MIN_MS || n > DEBUG_WAIT_MAX_MS) {
    throw new Error(`timeoutMs must be an integer between ${DEBUG_WAIT_MIN_MS} and ${DEBUG_WAIT_MAX_MS}`);
  }
  return n;
}

function readBool(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = asBool(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function unwrapRecords(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const out = [record];
  for (const key of NESTED_KEYS) {
    const nested = record[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      out.push(nested as Record<string, unknown>);
    }
  }
  return out;
}

function classifyState(state: string | undefined): SkillPhase | undefined {
  if (!state) return undefined;
  if (FAIL_STATE.test(state)) return "failed";
  if (SUCCESS_STATE.test(state)) return "succeeded";
  if (RUNNING_STATE.test(state)) return "running";
  if (IDLE_STATE.test(state)) return "idle";
  return undefined;
}

export function parseSkillStatus(text: string): ParsedSkillStatus {
  let raw: unknown = text;
  try {
    raw = JSON.parse(text);
  } catch {
    const lowered = text.toLowerCase();
    if (/\bfailed\b|\berror\b|失败/.test(lowered)) {
      return { phase: "failed", reason: text.slice(0, 300), raw };
    }
    if (/\brunning\b|执行中/.test(lowered)) {
      return { phase: "running", raw };
    }
    return { phase: "unknown", raw };
  }

  const records = unwrapRecords(raw);
  if (records.length === 0) return { phase: "unknown", raw };

  let running: boolean | undefined;
  let success: boolean | undefined;
  let pendingConfirm: boolean | undefined;
  let state: string | undefined;
  let reason: string | undefined;

  for (const record of records) {
    if (running === undefined) running = readBool(record, RUNNING_BOOL_KEYS);
    if (success === undefined) success = readBool(record, SUCCESS_BOOL_KEYS);
    if (pendingConfirm === undefined) pendingConfirm = readBool(record, ["pendingConfirm"]);
    if (state === undefined) state = readString(record, STATE_KEYS);
    if (reason === undefined) reason = readString(record, ERROR_STRING_KEYS);
    // Envelope `status: "ok"` is not an execution state; only treat it as
    // state when it looks like one of the execution vocabularies.
    if (state === undefined && typeof record.status === "string" && record.status !== "ok") {
      const classified = classifyState(record.status);
      if (classified) state = record.status;
    }
  }

  const fromState = classifyState(state);
  if (pendingConfirm === true && running !== true && fromState !== "running") {
    return { phase: "idle", reason, pendingConfirm: true, raw };
  }
  if (fromState === "failed" || success === false) {
    return { phase: "failed", reason, pendingConfirm, raw };
  }
  if (fromState === "succeeded" || success === true) {
    return { phase: "succeeded", reason, pendingConfirm, raw };
  }
  if (fromState === "running" || running === true) {
    return { phase: "running", reason, pendingConfirm, raw };
  }
  if (fromState === "idle" || running === false) {
    return { phase: "idle", reason, pendingConfirm, raw };
  }
  return { phase: "unknown", reason, pendingConfirm, raw };
}

export function bodyIndicatesPendingConfirm(body: string): boolean {
  if (!body.trim()) return false;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && (parsed as { pendingConfirm?: unknown }).pendingConfirm === true) {
      return true;
    }
  } catch {
    // fall through to text match
  }
  return /pendingConfirm\s*"?\s*:\s*true/i.test(body);
}

export function isAlreadyRunningFailure(_status: number, body: string): boolean {
  return /already running|alreadyRunning|is already running|正在运行/i.test(body);
}

export function isRetryableConfirmFailure(status: number, body: string): boolean {
  if (status === 401 || status === 429) return false;
  if (status !== 400 && status !== 404 && status !== 409 && status !== 425) return false;
  if (isAlreadyRunningFailure(status, body)) return false;
  if (status === 404) return true;
  return /pendingConfirm|not confirmed|awaiting confirm|waiting for confirm|未确认|请确认|确认框/i.test(body);
}

export function summarizeExecutionLog(text: string, maxChars = DEBUG_LOG_MAX_CHARS): string {
  const trimmed = text.trim();
  if (!trimmed) return "(no log lines)";
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(trimmed.length - maxChars);
}

export function formatDebugLoopText(opts: {
  skillId: string;
  outcome: DebugOutcome;
  elapsedMs: number;
  statusText?: string;
  logSummary: string;
  screenshotAttached?: boolean;
  screenshotNote?: string;
  pendingConfirmWaited?: boolean;
  extraLogs?: string;
}): string {
  const outcomeLine: Record<DebugOutcome, string> = {
    succeeded: `Skill ${opts.skillId} finished: succeeded`,
    failed: `Skill ${opts.skillId} finished: failed`,
    stopped: `Skill ${opts.skillId} stopped (no explicit success/fail flag; inspect the log)`,
    timeout: `Timed out after ${Math.round(opts.elapsedMs / 1000)}s waiting for ${opts.skillId} to finish`,
    disconnected: `Lost the device while waiting for ${opts.skillId}`,
    error: `Could not wait for ${opts.skillId} to finish`,
  };
  const lines = [outcomeLine[opts.outcome], `Elapsed: ${opts.elapsedMs}ms`];
  if (opts.pendingConfirmWaited) {
    lines.push("", PHONE_CONFIRM_NOTICE);
  }
  if (opts.screenshotAttached) {
    lines.push("", "A screenshot of the phone at failure/timeout is attached. Use it with the log to fix selectors; do not guess.");
  } else if (opts.screenshotNote) {
    lines.push("", opts.screenshotNote);
  }
  if (opts.statusText?.trim()) {
    lines.push("", "Last status:", opts.statusText.trim().slice(0, 1500));
  }
  lines.push("", "Log summary:", opts.logSummary);
  if (opts.extraLogs?.trim()) {
    lines.push("", "Logs:", opts.extraLogs.trim());
  }
  return lines.join("\n");
}

export type DebugWaitResult = {
  outcome: DebugOutcome;
  statusText: string;
  logSummary: string;
  screenshot?: FailureScreenshot;
  screenshotNote?: string;
  elapsedMs: number;
  logs: string;
};

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForSkillTerminal(opts: {
  getStatus: () => Promise<DeviceGetResult>;
  getLog: (limit: number) => Promise<DeviceGetResult>;
  getScreenshot?: () => Promise<FailureScreenshot | undefined>;
  timeoutMs: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  initialStatusText?: string;
}): Promise<DebugWaitResult> {
  const pollIntervalMs = opts.pollIntervalMs ?? DEBUG_POLL_INTERVAL_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + opts.timeoutMs;
  let seenRunning = false;
  let lastStatusText = opts.initialStatusText ?? "";
  let lastPhase: SkillPhase = "unknown";
  let logs = "";

  const finish = async (outcome: DebugOutcome, extraLogs = "") => {
    const elapsedMs = Math.max(0, now() - startedAt);
    let logSummary = "(log unavailable)";
    const logRes = await opts.getLog(DEBUG_LOG_LIMIT);
    if (logRes.ok) {
      logSummary = summarizeExecutionLog(logRes.text);
    } else if (logRes.disconnected) {
      return {
        outcome: "disconnected" as const,
        statusText: lastStatusText,
        logSummary,
        elapsedMs,
        logs: logs + extraLogs + (logRes.logs || ""),
      };
    } else if (logRes.status === 404) {
      logSummary = "(GET /api/mcp/logs is not on this App build)";
    } else {
      logSummary = `(could not read logs${logRes.status ? `, HTTP ${logRes.status}` : ""})`;
    }

    let screenshot: FailureScreenshot | undefined;
    let screenshotNote: string | undefined;
    if (outcome === "failed" || outcome === "timeout") {
      if (opts.getScreenshot) {
        screenshot = await opts.getScreenshot();
        if (!screenshot) {
          screenshotNote = "Screenshot unavailable; log summary is still below.";
        }
      }
    }

    return {
      outcome,
      statusText: lastStatusText,
      logSummary,
      screenshot,
      screenshotNote,
      elapsedMs,
      logs: logs + extraLogs,
    };
  };

  if (opts.initialStatusText) {
    const parsed = parseSkillStatus(opts.initialStatusText);
    lastPhase = parsed.phase;
    if (parsed.phase === "running") seenRunning = true;
    if (parsed.phase === "failed") return finish("failed");
    if (parsed.phase === "succeeded") return finish("succeeded");
  }

  do {
    const statusRes = await opts.getStatus();
    if (!statusRes.ok) {
      if (statusRes.disconnected) return finish("disconnected", statusRes.logs);
      if (statusRes.status === 404) {
        return finish(
          "error",
          (statusRes.logs || "") +
            "GET /api/mcp/status is not on this App build; started the skill but cannot wait here.\n"
        );
      }
      logs += statusRes.logs || "";
      await sleep(pollIntervalMs);
      continue;
    }

    lastStatusText = statusRes.text;
    const parsed = parseSkillStatus(statusRes.text);
    lastPhase = parsed.phase;
    if (parsed.phase === "running") seenRunning = true;
    if (parsed.phase === "failed") return finish("failed");
    if (parsed.phase === "succeeded") return finish("succeeded");
    if (seenRunning && parsed.phase === "idle") return finish("stopped");
    if (now() >= deadline) break;
    await sleep(pollIntervalMs);
  } while (now() < deadline);

  if (lastPhase === "running" || seenRunning) return finish("timeout");
  return finish("timeout");
}

export async function startThenWaitForSkill(opts: {
  start: () => Promise<DevicePostResult>;
  getStatus: () => Promise<DeviceGetResult>;
  getLog: (limit: number) => Promise<DeviceGetResult>;
  getScreenshot?: () => Promise<FailureScreenshot | undefined>;
  timeoutMs: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  waitForConfirm?: boolean;
}): Promise<
  | { kind: "waited"; waited: Awaited<ReturnType<typeof waitForSkillTerminal>>; pendingConfirmWaited: boolean; startLogs: string }
  | { kind: "start-failed"; start: DevicePostResult; pendingConfirmWaited: boolean }
> {
  const pollIntervalMs = opts.pollIntervalMs ?? DEBUG_POLL_INTERVAL_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const deadline = now() + opts.timeoutMs;
  let pendingConfirmWaited = Boolean(opts.waitForConfirm);
  let lastStart: DevicePostResult | undefined;
  let startLogs = "";

  while (now() < deadline) {
    lastStart = await opts.start();
    startLogs += lastStart.logs || "";
    if (lastStart.disconnected) {
      return { kind: "start-failed", start: lastStart, pendingConfirmWaited };
    }
    if (lastStart.ok || isAlreadyRunningFailure(lastStart.status, lastStart.body)) {
      const waited = await waitForSkillTerminal({
        getStatus: opts.getStatus,
        getLog: opts.getLog,
        getScreenshot: opts.getScreenshot,
        timeoutMs: Math.max(1, deadline - now()),
        pollIntervalMs,
        sleep,
        now,
        initialStatusText: lastStart.body,
      });
      return { kind: "waited", waited, pendingConfirmWaited, startLogs };
    }
    if (opts.waitForConfirm && isRetryableConfirmFailure(lastStart.status, lastStart.body)) {
      pendingConfirmWaited = true;
      await sleep(pollIntervalMs);
      continue;
    }
    return { kind: "start-failed", start: lastStart, pendingConfirmWaited };
  }

  return {
    kind: "start-failed",
    start: lastStart ?? {
      ok: false,
      status: 0,
      body: "",
      logs: startLogs + "Timed out waiting for phone confirmation before run.\n",
    },
    pendingConfirmWaited,
  };
}
