import fs from "fs";
import os from "os";
import path from "path";

export type PersistedDevice = {
  version: 1;
  baseUrl: string;
  pairingCode?: string;
  savedAt: string;
};

/** undefined = not loaded yet; null = loaded, nothing saved. */
let cache: PersistedDevice | null | undefined;

/**
 * Directory for the last successful pair_device record.
 * KUAIYOU_CONFIG_DIR overrides (empty string disables persistence — used by tests).
 */
export function getDeviceConfigDir(): string | undefined {
  if (Object.prototype.hasOwnProperty.call(process.env, "KUAIYOU_CONFIG_DIR")) {
    const trimmed = process.env.KUAIYOU_CONFIG_DIR?.trim() ?? "";
    return trimmed || undefined;
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "autoace");
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return path.join(xdg || path.join(os.homedir(), ".config"), "autoace");
}

export function getDeviceConfigPath(): string | undefined {
  const dir = getDeviceConfigDir();
  return dir ? path.join(dir, "device.json") : undefined;
}

export function resetDeviceConfigCache(): void {
  cache = undefined;
}

export function readPersistedDevice(): PersistedDevice | null {
  if (cache !== undefined) return cache;
  const file = getDeviceConfigPath();
  if (!file) {
    cache = null;
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const baseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim().replace(/\/+$/, "") : "";
    if (!baseUrl) {
      cache = null;
      return null;
    }
    const pairingCode =
      typeof parsed.pairingCode === "string" && parsed.pairingCode.trim()
        ? parsed.pairingCode.trim()
        : undefined;
    cache = {
      version: 1,
      baseUrl,
      pairingCode,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
    return cache;
  } catch {
    cache = null;
    return null;
  }
}

export function persistPairedDevice(input: {
  baseUrl: string;
  pairingCode?: string;
}): { ok: true; path: string } | { ok: false; error: string } {
  const dir = getDeviceConfigDir();
  const file = getDeviceConfigPath();
  if (!dir || !file) {
    return { ok: false, error: "device config persistence is disabled (KUAIYOU_CONFIG_DIR is empty)" };
  }
  const record: PersistedDevice = {
    version: 1,
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    pairingCode: input.pairingCode?.trim() || undefined,
    savedAt: new Date().toISOString(),
  };
  if (!record.baseUrl) {
    return { ok: false, error: "baseUrl must not be empty" };
  }
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Windows cannot always apply POSIX modes.
    }
    cache = record;
    return { ok: true, path: file };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function clearPersistedDevice(): void {
  cache = null;
  const file = getDeviceConfigPath();
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    // Missing file is the desired end state.
  }
}
