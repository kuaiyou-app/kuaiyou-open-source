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

/** Stable capability brief for humans — keep in sync with tools/list. */
export function formatCliCapabilities(): string {
  return [
    "当前 autoace-cli 可用能力：",
    "屏幕与调试：",
    "- capture_screenshot — 截取当前屏幕",
    "- get_ui_tree — 获取当前 UI 节点树",
    "技能（自动化 JSON）：",
    "- get_kuaiyou_schema — 拉取设备权威技能 Schema",
    "- validate_kuaiyou_skill / push_reactive_skill — 校验并部署（手机确认后生效）",
    "- list_skills / delete_skill / run_skill / stop_skill / get_skill_status / get_execution_log",
    "领域教练计划（需 App 暴露 /api/mcp/plans*）：",
    "- plans_schema / plans_list / plans_get / plans_validate / plans_deploy / plans_delete",
    "说明：部署技能或计划成功通常只表示 pendingConfirm；须用户在手机上确认。",
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
  if (opts.sessionOverrideApplied) {
    parts.push(
      "本次请求已用配对材料中的地址/配对码临时覆盖 MCP 进程 env（无需先重启 MCP）。请同步更新 mcp.json 中的 KUAIYOU_DEVICE_IP 与 KUAIYOU_MCP_PAIRING_CODE，否则下次冷启动仍会回到旧值。"
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
