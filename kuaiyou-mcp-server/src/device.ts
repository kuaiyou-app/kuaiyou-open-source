import { execFile, spawn } from "child_process";

const DEFAULT_HTTP_TIMEOUT_MS = 5000;
const DEFAULT_ADB_TIMEOUT_MS = 15000;
// Guardrail for buffered adb stdout (uiautomator dumps, etc.). Screenshots use
// the streaming path below and are not subject to this.
const DEFAULT_ADB_MAX_BUFFER = 16 * 1024 * 1024;

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

function authHeaders(): Record<string, string> {
  // Prefer short pairing code; keep KUAIYOU_MCP_TOKEN as a compatibility alias.
  const code = process.env.KUAIYOU_MCP_PAIRING_CODE || process.env.KUAIYOU_MCP_TOKEN;
  return code ? { Authorization: `Bearer ${code}` } : {};
}

function adbPrefix(): string[] {
  const serial = process.env.KUAIYOU_ADB_SERIAL;
  return serial ? ["-s", serial] : [];
}

// fetch() whose timeout covers the full response *including body consumption*.
// The AbortController is only cleared after the body is read, unlike a naive
// timeout that fires solely around the headers.
export async function httpGetText(url: string, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS): Promise<string> {
  return withAbort(timeoutMs, async (signal) => {
    const res = await fetch(url, { signal, headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.text();
  });
}

export async function httpGetBuffer(url: string, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS): Promise<Buffer> {
  return withAbort(timeoutMs, async (signal) => {
    const res = await fetch(url, { signal, headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
  });
}

export async function httpPostForm(
  url: string,
  form: URLSearchParams,
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS
): Promise<{ ok: boolean; status: number; statusText: string; body: string }> {
  return withAbort(timeoutMs, async (signal) => {
    const res = await fetch(url, {
      method: "POST",
      body: form,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        ...authHeaders(),
      },
      signal,
    });
    const body = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, statusText: res.statusText, body };
  });
}

/** Preferred import path: JSON body + optional Bearer token (LAN hardening). */
export async function httpPostJson(
  url: string,
  jsonBody: string,
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS
): Promise<{ ok: boolean; status: number; statusText: string; body: string }> {
  return withAbort(timeoutMs, async (signal) => {
    const res = await fetch(url, {
      method: "POST",
      body: jsonBody,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...authHeaders(),
      },
      signal,
    });
    const body = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, statusText: res.statusText, body };
  });
}

async function withAbort<T>(timeoutMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (e: any) {
    if (controller.signal.aborted) throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// adb invocation with an explicit timeout (the process is killed on expiry) and
// a bounded stdout buffer. No shell: args are passed as an array.
export function runAdb(
  args: string[],
  opts: { timeoutMs?: number; maxBuffer?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  const { timeoutMs = DEFAULT_ADB_TIMEOUT_MS, maxBuffer = DEFAULT_ADB_MAX_BUFFER } = opts;
  const fullArgs = [...adbPrefix(), ...args];
  return new Promise((resolve, reject) => {
    execFile("adb", fullArgs, { timeout: timeoutMs, maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        if ((error as any).killed && (error as any).signal === "SIGTERM") {
          reject(new TimeoutError(`adb ${args[0]} timed out after ${timeoutMs}ms`));
        } else {
          reject(error);
        }
        return;
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

// Stream the screenshot via `adb exec-out` so large PNGs are not truncated by
// exec's default maxBuffer and raw bytes are not mangled by a shell. Killed on timeout.
export function captureScreencap(timeoutMs = DEFAULT_ADB_TIMEOUT_MS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("adb", [...adbPrefix(), "exec-out", "screencap", "-p"]);
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new TimeoutError(`adb screencap timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => errChunks.push(chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(Buffer.concat(errChunks).toString() || `adb exited with code ${code}`));
      }
    });
  });
}

export function sniffImageMime(buffer: Buffer): string {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 6 &&
    (buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a")
  ) {
    return "image/gif";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return "application/octet-stream";
}

// Serialize device-mutating operations so concurrent tool calls don't interleave
// pushes/broadcasts against the same device.
let deviceLock: Promise<unknown> = Promise.resolve();
export function withDeviceLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = deviceLock.then(fn, fn);
  // Keep the chain alive regardless of this task's outcome.
  deviceLock = run.then(() => undefined, () => undefined);
  return run;
}
