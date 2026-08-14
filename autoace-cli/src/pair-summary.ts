/**
 * After a successful pair, synthesize a human-facing briefing from:
 * 1) the connection paste / pairing context the user supplied (App copy text), and
 * 2) pair success (plus endpoint from env).
 *
 * Do NOT invent or require an App pair-response `device` object — device portrait
 * comes from the user's pairing materials (McpConnectionPaste shape).
 */

export type ParsedConnectionInfo = {
  address?: string;
  /** Never log or echo the full code in summaries; only note whether one was present. */
  hasPairingCode: boolean;
  /**
   * Pairing code extracted for session override / HTTP auth.
   * Do not print this in user-facing summaries.
   */
  pairingCode?: string;
  /** Raw「设备：…」line when present. */
  deviceLine?: string;
  brand?: string;
  androidVersion?: string;
  resolution?: string;
  appVersion?: string;
};

/** Optional structured fields for pair_device (preferred over regex when present). */
export type StructuredConnectionFields = {
  host?: string;
  port?: string | number;
  code?: string;
  deviceLabel?: string;
};

export type PairAck = {
  paired: boolean;
  pairedAt?: number;
  rawBody: string;
};

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/** Acknowledge pair HTTP body without treating it as a device-profile contract. */
export function parsePairAck(body: string): PairAck {
  const rawBody = body ?? "";
  if (!rawBody.trim()) return { paired: true, rawBody };
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { paired: true, rawBody };
    }
    const rec = parsed as Record<string, unknown>;
    return {
      paired: rec.paired === true || rec.status === "ok",
      pairedAt: asFiniteNumber(rec.pairedAt),
      rawBody,
    };
  } catch {
    return { paired: true, rawBody };
  }
}

/**
 * Parse App「复制给 Agent」极简连接文案（及同类用户粘贴）。
 * Expected device line: `设备：{品牌} · Android {版本} · {宽}x{高} · App {版本}`
 */
export function parseConnectionInfo(text: string | undefined | null): ParsedConnectionInfo {
  const source = (text ?? "").trim();
  if (!source) {
    return { hasPairingCode: false };
  }

  const addressMatch = source.match(/(?:地址|Address)\s*[：:]\s*(\S+)/i);
  const codeMatch = source.match(/(?:配对码|Pairing\s*code|KUAIYOU_MCP_PAIRING_CODE)\s*[：:=]\s*(\S+)/i);
  const deviceMatch = source.match(/(?:设备|Device)\s*[：:]\s*(.+)$/im);
  const pairingCode = codeMatch?.[1]?.replace(/[，,。.\s]+$/, "");

  const info: ParsedConnectionInfo = {
    address: addressMatch?.[1]?.replace(/[，,。.\s]+$/, ""),
    hasPairingCode: Boolean(pairingCode),
    pairingCode: pairingCode || undefined,
    deviceLine: deviceMatch?.[1]?.trim(),
  };

  applyDeviceLinePortrait(info);

  return info;
}

function applyDeviceLinePortrait(info: ParsedConnectionInfo): void {
  if (!info.deviceLine) return;
  // Split on middle-dot / bullet separators used by McpConnectionPaste.
  const parts = info.deviceLine
    .split(/\s*[·•|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const android = part.match(/^Android\s+(.+)$/i);
    if (android) {
      info.androidVersion = android[1].trim();
      continue;
    }
    const app = part.match(/^App\s+(.+)$/i);
    if (app) {
      info.appVersion = app[1].trim();
      continue;
    }
    if (/^\d+\s*[x×]\s*\d+$/i.test(part)) {
      info.resolution = part.replace(/\s*[x×]\s*/i, "x");
      continue;
    }
    if (!info.brand) info.brand = part;
  }
}

/**
 * Merge structured pair_device fields over a paste parse. Structured host/port/code
 * win when present so Agents can avoid regex mis-parses.
 */
export function mergeConnectionInfo(
  paste: ParsedConnectionInfo,
  structured?: StructuredConnectionFields | null
): ParsedConnectionInfo {
  const merged: ParsedConnectionInfo = { ...paste };
  if (!structured) return merged;

  const host = typeof structured.host === "string" ? structured.host.trim() : "";
  const portRaw = structured.port;
  const port =
    portRaw === undefined || portRaw === null || portRaw === ""
      ? ""
      : String(portRaw).trim();
  if (host) {
    merged.address = port ? `${host}:${port}` : host;
  }

  const code = typeof structured.code === "string" ? structured.code.trim() : "";
  if (code) {
    merged.pairingCode = code;
    merged.hasPairingCode = true;
  }

  const label = typeof structured.deviceLabel === "string" ? structured.deviceLabel.trim() : "";
  if (label) {
    merged.deviceLine = label;
    merged.brand = undefined;
    merged.androidVersion = undefined;
    merged.resolution = undefined;
    merged.appVersion = undefined;
    applyDeviceLinePortrait(merged);
  }

  return merged;
}

export function formatConnectedDeviceContext(opts: {
  connection: ParsedConnectionInfo;
  configuredEndpoint?: string;
}): string {
  const { connection, configuredEndpoint } = opts;
  const endpoint = configuredEndpoint || connection.address || "（未提供地址）";

  const lines = ["已连接设备上下文："];
  lines.push(`- 地址：${endpoint}`);

  if (connection.brand || connection.androidVersion || connection.resolution || connection.appVersion) {
    if (connection.brand) lines.push(`- 品牌/型号：${connection.brand}`);
    if (connection.androidVersion) lines.push(`- 系统：Android ${connection.androidVersion}`);
    if (connection.resolution) lines.push(`- 屏幕：${connection.resolution}（px）`);
    if (connection.appVersion) lines.push(`- App：${connection.appVersion}`);
  } else if (connection.deviceLine) {
    lines.push(`- 设备：${connection.deviceLine}`);
  } else {
    lines.push(
      "- 设备画像：用户配对材料中未找到「设备：」行。请让用户粘贴 App 复制的连接信息（含品牌 · Android · 分辨率 · App 版本），或把该段原文传入 pair_device.connectionInfo。"
    );
  }

  return lines.join("\n");
}

/** Default-path briefing after pair — not a dump of tools/list. */
export function formatCliCapabilities(): string {
  return [
    "默认自动化主路径（按这个走，不要把其它工具当并列主功能）：",
    "- pair_device — 配对",
    "- observe_screen — 看屏（写选择器时用这个；不要默认 get_ui_tree / capture_screenshot）",
    "- get_kuaiyou_prompts + get_kuaiyou_schema — 设备权威生成规则与技能契约",
    "- validate_kuaiyou_skill → push_reactive_skill — 校验并部署（须手机确认）",
    "- push 可带 run: true（或随后 run_skill wait: true）— 等到结束/失败，返回 log 摘要；失败带截屏",
    "",
    "领域教练：仅当用户明确要求学习计划 / 领域教练时再用 plans_*，见 Agent Skill「Plans flow」。",
    "按需工具（list_skills / delete_skill / stop_skill / get_ui_tree 等）完整表见 reference.md。",
    "说明：部署成功通常只表示 pendingConfirm；须用户在手机上确认。CLI 不能跳过该确认框。",
  ].join("\n");
}

export function formatPairSuccessMessage(opts: {
  ack: PairAck;
  connection: ParsedConnectionInfo;
  configuredEndpoint?: string;
  logs: string;
  legacyNoPairRoute?: boolean;
  /** True when connectionInfo/structured fields overrode process env for this session. */
  sessionOverrideApplied?: boolean;
  persistResult?: { ok: true; path: string } | { ok: false; error: string };
}): string {
  const parts: string[] = [];
  if (opts.legacyNoPairRoute) {
    parts.push("设备没有 /api/mcp/pair（旧 App）；已按兼容路径继续。");
  } else {
    parts.push("配对成功。手机设置页应显示「已配对」。");
    if (opts.ack.pairedAt !== undefined) {
      parts.push(`pairedAt=${opts.ack.pairedAt}`);
    }
  }
  if (opts.persistResult?.ok) {
    parts.push(
      `已保存到本机 ${opts.persistResult.path}（权限 600，勿提交到 Git）。下次冷启动会自动使用，无需改 mcp.json。换设备或 App 重新开启 MCP 时再 pair_device 即可覆盖。`
    );
  } else if (opts.sessionOverrideApplied) {
    parts.push(
      opts.persistResult
        ? `本机保存失败（${opts.persistResult.error}）。本次进程已用配对材料覆盖地址，但冷启动仍可能回到 mcp.json 旧值。`
        : "本次请求已用配对材料中的地址/配对码覆盖本进程目标（无需先重启 MCP）。"
    );
  }
  parts.push("");
  parts.push(
    formatConnectedDeviceContext({
      connection: opts.connection,
      configuredEndpoint: opts.configuredEndpoint,
    })
  );
  parts.push("");
  parts.push(formatCliCapabilities());
  parts.push("");
  parts.push(
    "请把以上「已连接设备上下文」与「可用能力」展示给用户。若用户同条消息已给出编写任务则立即继续；否则等待具体指示。"
  );
  parts.push("");
  parts.push(`Logs:\n${opts.logs}`);
  return parts.join("\n");
}
