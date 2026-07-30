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
 * Resolve the device endpoint once, with an explicit URL taking precedence.
 * KUAIYOU_DEVICE_IP remains an HTTP compatibility path for current App builds;
 * KUAIYOU_DEVICE_URL lets a future TLS-capable App provide an https:// endpoint.
 */
export function resolveDeviceBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
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

function authHeaders(): Record<string, string> {
  // Prefer short pairing code; keep KUAIYOU_MCP_TOKEN as a compatibility alias.
  const code = process.env.KUAIYOU_MCP_PAIRING_CODE || process.env.KUAIYOU_MCP_TOKEN;
  return code ? { Authorization: `Bearer ${code}` } : {};
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
