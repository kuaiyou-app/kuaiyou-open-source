const DEFAULT_HTTP_TIMEOUT_MS = 5000;
const DEFAULT_TEXT_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_IMAGE_RESPONSE_LIMIT_BYTES = 12 * 1024 * 1024;
const DEFAULT_POST_RESPONSE_LIMIT_BYTES = 512 * 1024;

/** Non-2xx response. Carries the status so callers can tell a missing route
 *  (404) apart from an unreachable device or a rejected pairing code. */
export class HttpStatusError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export class ResponseTooLargeError extends Error {
  readonly limitBytes: number;
  constructor(limitBytes: number) {
    super(`Response body exceeds the ${limitBytes}-byte limit`);
    this.name = "ResponseTooLargeError";
    this.limitBytes = limitBytes;
  }
}

/**
 * Current KUAIYOU_DEVICE_IP / session override cannot be reached (timeout,
 * ECONNREFUSED, or GET /api/mcp/health never answered). Not for HTTP 401/404.
 */
export class DeviceDisconnectedError extends Error {
  readonly endpoint: string;
  constructor(endpoint: string, cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : cause ? String(cause) : "";
    super(
      `Device disconnected or address is stale (${endpoint})${detail ? `: ${detail}` : ""}`
    );
    this.name = "DeviceDisconnectedError";
    this.endpoint = endpoint;
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** True for timeout / connection-refused / DNS — not for HTTP 401/404/429. */
export function isDeviceUnreachable(error: unknown): boolean {
  if (error instanceof DeviceDisconnectedError) return true;
  if (error instanceof TimeoutError) return true;
  if (error instanceof HttpStatusError) return false;
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const rec = current as { code?: unknown; cause?: unknown; name?: unknown; message?: unknown };
    if (typeof rec.code === "string" && UNREACHABLE_CODES.has(rec.code)) return true;
    const message = typeof rec.message === "string" ? rec.message : "";
    if (rec.name === "TypeError" && /fetch failed|network/i.test(message)) return true;
    current = rec.cause;
  }
  return false;
}

/**
 * In-process session overrides from pair_device.connectionInfo (or structured
 * host/port/code). Takes precedence over mcp.json env for this MCP process so
 * Agents can retarget without waiting for a Cursor MCP reload.
 */
export type SessionDeviceOverride = {
  baseUrl?: string;
  pairingCode?: string;
};

let sessionOverride: SessionDeviceOverride = {};

export function getSessionDeviceOverride(): SessionDeviceOverride {
  return { ...sessionOverride };
}

export function setSessionDeviceOverride(partial: SessionDeviceOverride): void {
  const next: SessionDeviceOverride = { ...sessionOverride };
  if (partial.baseUrl !== undefined) {
    const trimmed = partial.baseUrl.trim().replace(/\/+$/, "");
    next.baseUrl = trimmed || undefined;
  }
  if (partial.pairingCode !== undefined) {
    const code = partial.pairingCode.trim();
    next.pairingCode = code || undefined;
  }
  sessionOverride = next;
  // Endpoint or code change invalidates the cached pair handshake.
  clearDevicePairingSession();
}

export function clearSessionDeviceOverride(): void {
  sessionOverride = {};
  clearDevicePairingSession();
}

/**
 * Turn App paste `host:port` (or a full http(s) URL) into a base URL for fetch.
 */
export function addressToBaseUrl(address: string): string {
  const trimmed = address.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("device address must not be empty");
  }
  if (trimmed.includes("://")) {
    return resolveDeviceBaseUrlFromEnv({ KUAIYOU_DEVICE_URL: trimmed })!;
  }
  return resolveDeviceBaseUrlFromEnv({ KUAIYOU_DEVICE_IP: trimmed })!;
}

/**
 * Resolve the device endpoint once, with an explicit URL taking precedence.
 * KUAIYOU_DEVICE_IP remains an HTTP compatibility path for current App builds;
 * KUAIYOU_DEVICE_URL lets a future TLS-capable App provide an https:// endpoint.
 *
 * When a session override baseUrl is set (from connectionInfo), it wins over env
 * so retargeting does not require restarting the MCP process.
 */
export function resolveDeviceBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (sessionOverride.baseUrl) {
    return sessionOverride.baseUrl;
  }
  return resolveDeviceBaseUrlFromEnv(env);
}

function resolveDeviceBaseUrlFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const explicitUrl = env.KUAIYOU_DEVICE_URL?.trim();
  if (explicitUrl) {
    let parsed: URL;
    try {
      parsed = new URL(explicitUrl);
    } catch {
      throw new Error("KUAIYOU_DEVICE_URL must be a valid http:// or https:// URL");
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
      throw new Error("KUAIYOU_DEVICE_URL must use http:// or https:// and must not contain credentials");
    }
    if (parsed.search || parsed.hash) {
      throw new Error("KUAIYOU_DEVICE_URL must not contain a query string or fragment");
    }
    return explicitUrl.replace(/\/+$/, "");
  }

  const deviceIp = env.KUAIYOU_DEVICE_IP?.trim();
  if (!deviceIp) return undefined;
  if (deviceIp.includes("://") || /[/?#@]/.test(deviceIp)) {
    throw new Error("KUAIYOU_DEVICE_IP must contain only a host or host:port; use KUAIYOU_DEVICE_URL for a full URL");
  }
  if (deviceIp.split(":").length > 2 && !deviceIp.startsWith("[")) {
    throw new Error("IPv6 KUAIYOU_DEVICE_IP values must use bracket notation, for example [::1]:8080");
  }
  const hasPort = /:\d+$/.test(deviceIp) || /^\[[^\]]+\]:\d+$/.test(deviceIp);
  return `http://${deviceIp}${hasPort ? "" : ":8080"}`;
}

function resolvePairingCode(env: NodeJS.ProcessEnv = process.env): string {
  if (sessionOverride.pairingCode) return sessionOverride.pairingCode;
  // Prefer short pairing code; keep KUAIYOU_MCP_TOKEN as a compatibility alias.
  return env.KUAIYOU_MCP_PAIRING_CODE || env.KUAIYOU_MCP_TOKEN || "";
}

function authHeaders(): Record<string, string> {
  const code = resolvePairingCode();
  return code ? { Authorization: `Bearer ${code}` } : {};
}

/** Once per process+endpoint+code; drives App settings「已配对」via POST /api/mcp/pair. */
let pairedSessionKey: string | undefined;
/** Last successful pair body for the current session (device context). */
let lastPairBody: string | undefined;

const HEALTH_PATH = "/api/mcp/health";
/** Skip a repeat health probe for the same baseUrl within this window. */
const HEALTH_TTL_MS = 3000;
let lastHealthOkAt = 0;
let lastHealthBaseUrl: string | undefined;

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function forgetDeviceHealth(): void {
  lastHealthOkAt = 0;
  lastHealthBaseUrl = undefined;
}

export function clearDevicePairingSession(): void {
  pairedSessionKey = undefined;
  lastPairBody = undefined;
  forgetDeviceHealth();
}

/**
 * Transport died: drop the cached pair handshake and any session override so
 * the next call does not keep hammering a stale host:port.
 */
export function markDeviceDisconnected(): void {
  clearSessionDeviceOverride();
}

export type EnsurePairedResult = {
  /** True when this call skipped HTTP because the session was already paired. */
  reusedSession: boolean;
  /** True when the App answered 404 for /pair (legacy builds). */
  legacyNoPairRoute: boolean;
  /** Raw JSON body from POST /api/mcp/pair when a request was made. */
  body: string;
};

/**
 * Explicit device handshake. Safe to call repeatedly; no-ops after success for the
 * same baseUrl+pairing code. Older Apps without /pair (HTTP 404) are treated as
 * already paired so tooling keeps working.
 *
 * Returns the pair response body (including device profile when the App provides it)
 * so callers like pair_device can show context to the user.
 */
export async function ensureDevicePaired(
  baseUrl: string,
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS
): Promise<EnsurePairedResult> {
  const code = resolvePairingCode();
  const key = `${baseUrl.replace(/\/+$/, "")}|${code}`;
  if (pairedSessionKey === key) {
    return {
      reusedSession: true,
      legacyNoPairRoute: false,
      body: lastPairBody ?? "",
    };
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/api/mcp/pair`;
  const res = await httpPostJson(url, "{}", timeoutMs);
  if (res.ok) {
    pairedSessionKey = key;
    lastPairBody = res.body ?? "";
    return { reusedSession: false, legacyNoPairRoute: false, body: lastPairBody };
  }
  if (res.status === 404) {
    pairedSessionKey = key;
    lastPairBody = "";
    return { reusedSession: false, legacyNoPairRoute: true, body: "" };
  }
  throw new HttpStatusError(res.status, res.statusText || res.body.slice(0, 200));
}

// fetch() whose timeout covers the full response *including body consumption*.
// The AbortController is only cleared after the body is read, unlike a naive
// timeout that fires solely around the headers.
export async function httpGetText(
  url: string,
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  maxBytes = DEFAULT_TEXT_RESPONSE_LIMIT_BYTES
): Promise<string> {
  return withAbort(timeoutMs, async (signal) => {
    const res = await fetch(url, { signal, headers: authHeaders() });
    if (!res.ok) throw new HttpStatusError(res.status, res.statusText);
    return (await readBodyLimited(res, maxBytes)).toString("utf8");
  });
}

export async function httpGetBuffer(
  url: string,
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  maxBytes = DEFAULT_IMAGE_RESPONSE_LIMIT_BYTES
): Promise<Buffer> {
  return withAbort(timeoutMs, async (signal) => {
    const res = await fetch(url, { signal, headers: authHeaders() });
    if (!res.ok) throw new HttpStatusError(res.status, res.statusText);
    return readBodyLimited(res, maxBytes);
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
    const body = await readBodyTextOrEmpty(res, DEFAULT_POST_RESPONSE_LIMIT_BYTES);
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
    const body = await readBodyTextOrEmpty(res, DEFAULT_POST_RESPONSE_LIMIT_BYTES);
    return { ok: res.ok, status: res.status, statusText: res.statusText, body };
  });
}

async function readBodyTextOrEmpty(res: Response, maxBytes: number): Promise<string> {
  try {
    return (await readBodyLimited(res, maxBytes)).toString("utf8");
  } catch (error) {
    if (error instanceof ResponseTooLargeError) throw error;
    return "";
  }
}

async function readBodyLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(res.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(maxBytes);
  }
  if (!res.body) return Buffer.alloc(0);

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseTooLargeError(maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
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

/** Unauthenticated GET — used only for /api/mcp/health. Non-2xx is still "device answered". */
async function httpGetNoAuth(
  url: string,
  timeoutMs: number,
  maxBytes: number
): Promise<{ status: number; statusText: string; body: string }> {
  return withAbort(timeoutMs, async (signal) => {
    const res = await fetch(url, { signal });
    const body = await readBodyTextOrEmpty(res, maxBytes);
    return { status: res.status, statusText: res.statusText, body };
  });
}

/**
 * Probe GET /api/mcp/health (no Bearer) before device GET/POST.
 * HTTP 200 (or any HTTP status) = channel up. Timeout / ECONNREFUSED = disconnected.
 * Short TTL avoids a probe on every tool in a burst; a later call after TTL
 * (or after markDeviceDisconnected) will notice a restarted device / new port.
 */
export async function ensureDeviceReachable(
  baseUrl: string,
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS
): Promise<void> {
  const endpoint = normalizedBaseUrl(baseUrl);
  if (lastHealthBaseUrl === endpoint && Date.now() - lastHealthOkAt < HEALTH_TTL_MS) {
    return;
  }
  const url = `${endpoint}${HEALTH_PATH}`;
  try {
    await httpGetNoAuth(url, timeoutMs, 64 * 1024);
    lastHealthBaseUrl = endpoint;
    lastHealthOkAt = Date.now();
  } catch (error) {
    if (isDeviceUnreachable(error)) {
      markDeviceDisconnected();
      throw new DeviceDisconnectedError(endpoint, error);
    }
    throw error;
  }
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
