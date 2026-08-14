import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as dotenv from "dotenv";
import { formatLintResult, validateSkillPayload } from "./skill-lint.js";
import { formatPlanLintResult, validatePlanPayload } from "./plan-lint.js";
import {
  formatPairSuccessMessage,
  mergeConnectionInfo,
  parseConnectionInfo,
  parsePairAck,
} from "./pair-summary.js";
import { type ContractValidator } from "./contract-schema-validator.js";
import {
  fetchDeviceContractValidator,
  PLAN_SCHEMA_PATH,
  SKILL_SCHEMA_PATH,
} from "./device-schema.js";
import { enhanceUiNodes, formatObserveSummary, summarizeScreenTree } from "./observe.js";
import {
  PHONE_CONFIRM_NOTICE,
  asBool,
  formatDebugLoopText,
  resolveWaitTimeoutMs,
  startThenWaitForSkill,
  type FailureScreenshot,
  type DebugWaitResult,
} from "./skill-debug.js";
import {
  DeviceDisconnectedError,
  HttpStatusError,
  addressToBaseUrl,
  clearDevicePairingSession,
  ensureDevicePaired,
  ensureDeviceReachable,
  httpGetText,
  httpGetBuffer,
  httpPostJson,
  httpPostForm,
  isDeviceUnreachable,
  markDeviceDisconnected,
  persistPairedDevice,
  resolveDeviceBaseUrl,
  setSessionDeviceOverride,
  sniffImageMime,
  withDeviceLock,
} from "./device.js";

dotenv.config();

// skillId / planId are interpolated into device-side paths, so restrict to a
// conservative charset. This blocks path traversal (../) and shell metacharacters
// even though device calls no longer go through a shell.
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SKILL_ID_PATTERN = RESOURCE_ID_PATTERN;
const PLAN_ID_PATTERN = RESOURCE_ID_PATTERN;

type ToolErrorResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
};

const PACKAGE_JSON = require("../package.json") as { name: string; version: string };

const server = new Server(
  {
    name: PACKAGE_JSON.name,
    version: PACKAGE_JSON.version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const getDeviceBaseUrl = () => {
  try {
    return resolveDeviceBaseUrl();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InvalidParams, `Invalid device address configuration: ${detail}`);
  }
};

// The CLI talks to the device over the LAN HTTP channel only. These two
// helpers keep the "no device" and "device unreachable" messages consistent
// across every tool instead of repeating the guidance inline.
function missingDeviceIp(toolName: string, logs = ""): ToolErrorResponse {
  return {
    content: [
      {
        type: "text",
        text:
          `${toolName} needs a device address.\n` +
          `Call pair_device with the App「复制给 Agent」paste (saved on this machine after success), ` +
          `or set KUAIYOU_DEVICE_URL / KUAIYOU_DEVICE_IP and KUAIYOU_MCP_PAIRING_CODE.` +
          (logs ? `\n\nLogs:\n${logs}` : ""),
      },
    ],
    isError: true,
  };
}

const DEVICE_DISCONNECTED_USER_MESSAGE =
  "设备已断开或地址已失效，需要重新配对。请到 App 设置 → MCP 服务 重新复制「复制给 Agent」，再调用 pair_device（connectionInfo 全文）。" +
  "成功后会覆盖本机保存的地址与配对码，无需改 mcp.json，也无需仅为换地址而重载 MCP。\n" +
  "The configured device is disconnected or its address is stale. Re-pair: re-copy「复制给 Agent」from the App and call pair_device with the full connectionInfo. " +
  "A successful pair overwrites the machine-local saved target; you do not need to edit mcp.json or reload MCP just to change the address.";

function deviceDisconnectedFailure(logs: string): ToolErrorResponse {
  return {
    content: [
      {
        type: "text",
        text: DEVICE_DISCONNECTED_USER_MESSAGE + (logs ? `\n\nLogs:\n${logs}` : ""),
      },
    ],
    isError: true,
  };
}

function noteUnreachableAndFail(error: unknown, logs: string): ToolErrorResponse {
  if (!(error instanceof DeviceDisconnectedError)) {
    markDeviceDisconnected();
  }
  return deviceDisconnectedFailure(logs);
}

function deviceHttpFailure(what: string, logs: string) {
  return {
    content: [
      {
        type: "text",
        text:
          `Failed to ${what} over the LAN HTTP channel.\n` +
          `Check that: the App's MCP 服务 switch is on; phone and computer are on the same network; ` +
          `KUAIYOU_DEVICE_IP matches the address the App shows (it changes when the App restarts); ` +
          `and KUAIYOU_MCP_PAIRING_CODE matches the current pairing code.\n\nLogs:\n${logs}`,
      },
    ],
    isError: true,
  };
}

/**
 * The device answered, it just refused the request. Reporting these as channel
 * problems sent people checking their Wi-Fi when the actual cause was a skill
 * the App rejected, an expired pairing code, or a route the build lacks.
 */
function deviceRejected(what: string, status: number, body: string, logs: string): ToolErrorResponse {
  // Keyed by status rather than a nested ternary: these hints get edited often
  // and the ternary chain had already picked up a duplicated branch.
  const hints: Record<number, string> = {
    401: `The pairing code was rejected. It is regenerated every time the MCP service restarts — copy the current one from the App.`,
    403: `The device refused the request origin or host. Point KUAIYOU_DEVICE_IP at the exact address the App shows.`,
    404: `The device has no such route or resource (an older App build, or the skill id does not exist).`,
    409: `The device refused to store this: usually the skill or learning-plan quota is full. Delete an unused item (delete_skill / plans_delete) or upgrade, then push again.`,
    429: `Too many failed pairing-code attempts; the device is backing off. Wait for the Retry-After window, then use the current code.`,
    503: `The App cannot serve this right now — most often the accessibility permission is off, so the automation engine is not running.`,
  };
  const hint =
    hints[status] ??
    (status >= 500
      ? `The App hit an internal error handling the request; check the device logs.`
      : `The device rejected the request content. The reason from the device is in the response below.`);
  const detail = body.trim() ? `\n\nDevice response:\n${body.slice(0, 2000)}` : "";
  return {
    content: [
      {
        type: "text" as const,
        text: `The device refused to ${what} (HTTP ${status}).\n${hint}${detail}\n\nLogs:\n${logs}`,
      },
    ],
    isError: true,
  };
}

/** Same split as deviceGetFailure, for the POST tools. */
function devicePostFailure(
  toolName: string,
  what: string,
  res: { status: number; body: string; logs: string; disconnected?: boolean }
) {
  if (!getDeviceBaseUrl()) return missingDeviceIp(toolName, res.logs);
  if (res.disconnected) return deviceDisconnectedFailure(res.logs);
  if (res.status === 404) return deviceRejected(what, 404, res.body, res.logs);
  if (res.status > 0) return deviceRejected(what, res.status, res.body, res.logs);
  return deviceDisconnectedFailure(res.logs);
}

function toolNotImplemented(name: string, hint: string) {
  return {
    content: [
      {
        type: "text",
        text:
          `${name} is not available yet on this App build.\n` +
          `${hint}\n` +
          `Ensure LAN MCP service is enabled and the device App exposes the matching /api/mcp/* route.`,
      },
    ],
    isError: true,
  };
}

function schemaUnavailable(
  toolName: string,
  schemaPath: string,
  kind: "skill" | "learning-plan",
  detail: string,
  logs: string
): ToolErrorResponse {
  return {
    content: [
      {
        type: "text" as const,
        text:
          `${toolName} could not load the authoritative ${kind} schema from the App.\n` +
          `Ensure the App MCP service is enabled and GET ${schemaPath} returns a valid JSON Schema.\n` +
          `Reason: ${detail}\n\nLogs:\n${logs}`,
      },
    ],
    isError: true,
  };
}

async function loadDeviceContract(
  toolName: string,
  schemaPath: string = SKILL_SCHEMA_PATH,
  kind: "skill" | "learning-plan" = "skill"
): Promise<{ ok: true; validator: ContractValidator } | { ok: false; response: ToolErrorResponse }> {
  const baseUrl = getDeviceBaseUrl();
  if (!baseUrl) {
    return { ok: false, response: missingDeviceIp(toolName) };
  }

  const logs = `GET ${baseUrl}${schemaPath}\n`;
  try {
    await ensureDeviceReachable(baseUrl);
    await ensureDevicePaired(baseUrl);
    return { ok: true, validator: await fetchDeviceContractValidator(baseUrl, schemaPath) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failLogs = `${logs}Failed: ${detail}\n`;
    if (error instanceof DeviceDisconnectedError || isDeviceUnreachable(error)) {
      return { ok: false, response: noteUnreachableAndFail(error, failLogs) };
    }
    if (error instanceof HttpStatusError) {
      return { ok: false, response: deviceRejected(`fetch the authoritative ${kind} schema`, error.status, "", failLogs) };
    }
    return {
      ok: false,
      response: schemaUnavailable(toolName, schemaPath, kind, detail, failLogs),
    };
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_kuaiyou_schema",
        description:
          "Fetch the authoritative skill JSON Schema from the connected App via GET /api/mcp/schema. Also completes device pairing so the App settings page shows 已配对.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_kuaiyou_prompts",
        description:
          "Fetch App generation rules via GET /api/mcp/prompts (skill template + per-scenario plan outlines + hydrate). Authority is the device only — never cache or commit the payload; ignore unknown fields. 404 means upgrade the App; do not use repo markdown as a fallback.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "pair_device",
        description:
          "Pair with the App MCP service (POST /api/mcp/pair), then synthesize a user-facing briefing. Pass connectionInfo whenever the user pasted App copy text. Address/code from this call override env for this process and are saved under the user config dir (default ~/.config/autoace/device.json) so the next cold start does not need mcp.json edits. Present the briefing to the user before taking skill/plan instructions.",
        inputSchema: {
          type: "object",
          properties: {
            connectionInfo: {
              type: "string",
              description:
                "Optional. The full App「复制给 Agent」paste (or at least the 设备： line). Device brand/Android/resolution/App version are taken from this text — not invented from the pair HTTP body. Address and pairing code here override KUAIYOU_DEVICE_IP / KUAIYOU_MCP_PAIRING_CODE for subsequent tools in this process.",
            },
            host: {
              type: "string",
              description:
                "Optional structured host (or host:port). Wins over address parsed from connectionInfo when set.",
            },
            port: {
              type: "string",
              description: "Optional structured port. Combined with host when host has no port.",
            },
            code: {
              type: "string",
              description:
                "Optional structured pairing code. Wins over code parsed from connectionInfo when set. Never echo in user summaries.",
            },
            deviceLabel: {
              type: "string",
              description:
                "Optional structured device line (e.g. Xiaomi · Android 14 · 1080x2400 · App 2.9.0). Wins over 设备： from connectionInfo when set.",
            },
          },
        },
      },
      {
        name: "validate_kuaiyou_skill",
        description:
          "Fetch the authoritative schema from the connected App, then validate a JSON string or .json file path and run business lint.",
        inputSchema: {
          type: "object",
          properties: {
            skillJson: {
              type: "string",
              description: "Skill JSON content, or an absolute / relative .json file path.",
            },
          },
          required: ["skillJson"],
        },
      },
      {
        name: "push_reactive_skill",
        description:
          "Fetch the App schema, validate, then deploy a skill JSON over the LAN HTTP channel. skillJson accepts the same JSON string or .json file path as validate_kuaiyou_skill. Optional run=true starts the skill after deploy and waits until it stops or fails, returning a log summary (screenshot on failure). The phone confirmation dialog is still required — this CLI cannot skip it.",
        inputSchema: {
          type: "object",
          properties: {
            skillId: {
              type: "string",
              description: "The ID of the skill.",
            },
            skillJson: {
              type: "string",
              description: "Skill JSON content, or an absolute / relative .json file path (same as validate_kuaiyou_skill).",
            },
            run: {
              type: "boolean",
              description:
                "If true, start the skill after a successful deploy and wait until it terminates or fails. Default false. Phone confirmation is still required; this CLI does not skip the App dialog.",
            },
            timeoutMs: {
              type: "integer",
              minimum: 1000,
              maximum: 180000,
              description: "Max wait when run=true (default 90000, maximum 180000).",
            },
          },
          required: ["skillId", "skillJson"],
        },
      },
      {
        name: "observe_screen",
        description:
          "Preferred look-at-the-phone tool: screenshot plus a compact list of interactive nodes (text/id/bounds/centerPct) and current package. Use this before writing selectors. Fall back to get_ui_tree only when you need the full dump.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_ui_tree",
        description:
          "Full UI node tree from GET /api/mcp/ui_tree. Prefer observe_screen for authoring; this dump is large and may include sensitive on-screen text.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "capture_screenshot",
        description:
          "Fetch the current screen screenshot only. Prefer observe_screen when authoring skills (screenshot + interactive nodes together).",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "list_skills",
        description: "List skills installed on the device (requires App /api/mcp/skills).",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "delete_skill",
        description: "Delete a skill by id on the device (requires App /api/mcp/skills DELETE).",
        inputSchema: {
          type: "object",
          properties: {
            skillId: { type: "string", description: "Skill id to delete." },
          },
          required: ["skillId"],
        },
      },
      {
        name: "run_skill",
        description:
          "Start executing a skill on the device (POST /api/mcp/run). Optional wait=true polls status until the skill stops or fails, then returns a log summary; failure/timeout attaches a screenshot. Does not skip phone confirmation.",
        inputSchema: {
          type: "object",
          properties: {
            skillId: { type: "string" },
            wait: {
              type: "boolean",
              description:
                "If true, wait until the skill terminates or fails, then return get_execution_log summary. Default false (fire-and-forget).",
            },
            timeoutMs: {
              type: "integer",
              minimum: 1000,
              maximum: 180000,
              description: "Max wait when wait=true (default 90000, maximum 180000).",
            },
          },
          required: ["skillId"],
        },
      },
      {
        name: "stop_skill",
        description: "Stop the currently running skill (requires App /api/mcp/stop).",
        inputSchema: {
          type: "object",
          properties: {
            skillId: { type: "string", description: "Optional skill id hint." },
          },
        },
      },
      {
        name: "get_skill_status",
        description: "Get execution status for a skill (requires App /api/mcp/status).",
        inputSchema: {
          type: "object",
          properties: {
            skillId: { type: "string" },
          },
          required: ["skillId"],
        },
      },
      {
        name: "get_execution_log",
        description: "Fetch recent execution logs for a skill (requires App /api/mcp/logs).",
        inputSchema: {
          type: "object",
          properties: {
            skillId: { type: "string" },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 1000,
              description: "Max log lines (default 100, maximum 1000).",
            },
          },
          required: ["skillId"],
        },
      },
      {
        name: "plans_schema",
        description:
          "Only when the user explicitly asks for a 领域教练 learning plan. Fetch the authoritative LearningPlan JSON Schema from the App via GET /api/mcp/plans/schema. Schema is never bundled in this CLI — always runtime from the device.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "plans_list",
        description:
          "Only when the user explicitly asks for a 领域教练 learning plan. List domain-coach learning plans on the device (GET /api/mcp/plans). Summary fields: id, name, goal, phaseCount, nodeCount, updatedAt.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "plans_get",
        description:
          "Only when the user explicitly asks for a 领域教练 learning plan. Fetch a full LearningPlan JSON by id (GET /api/mcp/plans/{id}).",
        inputSchema: {
          type: "object",
          properties: {
            planId: { type: "string", description: "Plan id to fetch." },
          },
          required: ["planId"],
        },
      },
      {
        name: "plans_validate",
        description:
          "Only when the user explicitly asks for a 领域教练 learning plan. Validate a LearningPlan JSON against the device schema (GET /api/mcp/plans/schema), then POST /api/mcp/plans/validate for on-device structural/DAG checks. Does not persist.",
        inputSchema: {
          type: "object",
          properties: {
            planJson: {
              type: "string",
              description: "LearningPlan JSON content or absolute .json file path.",
            },
          },
          required: ["planJson"],
        },
      },
      {
        name: "plans_deploy",
        description:
          "Only when the user explicitly asks for a 领域教练 learning plan. Validate then deploy a LearningPlan to the device (POST /api/mcp/plans). Success means pendingConfirm=true — the user must confirm on the phone before it appears in 领域教练. Same id overwrites outline and progress; new id may return HTTP 409 if quota is full.",
        inputSchema: {
          type: "object",
          properties: {
            planJson: {
              type: "string",
              description: "LearningPlan JSON content or absolute .json file path.",
            },
          },
          required: ["planJson"],
        },
      },
      {
        name: "plans_delete",
        description:
          "Only when the user explicitly asks for a 领域教练 learning plan. Delete a learning plan immediately on the device (POST /api/mcp/plans/delete with { planId }). No confirmation dialog.",
        inputSchema: {
          type: "object",
          properties: {
            planId: { type: "string", description: "Plan id to delete." },
          },
          required: ["planId"],
        },
      },
    ],
  };
});

async function resolveJsonFileOrContent(input: string, paramName: string): Promise<string> {
  // Only treat as a file path when it looks like one and ends with .json.
  const looksLikePath =
    input.endsWith(".json") &&
    (input.startsWith("/") ||
      input.startsWith("./") ||
      input.startsWith("../") ||
      /^[A-Za-z]:[\\/]/.test(input));
  if (!looksLikePath) return input;

  try {
    const stat = await fs.stat(input);
    if (!stat.isFile()) {
      throw new McpError(ErrorCode.InvalidParams, `${paramName} path is not a file: ${input}`);
    }
    if (!input.toLowerCase().endsWith(".json")) {
      throw new McpError(ErrorCode.InvalidParams, `File path ${paramName} must end with .json`);
    }
    return await fs.readFile(input, "utf8");
  } catch (e: any) {
    if (e instanceof McpError) throw e;
    // Path-looking string that does not exist: fall through as JSON body.
    return input;
  }
}

async function resolveSkillJsonInput(skillJson: string): Promise<string> {
  return resolveJsonFileOrContent(skillJson, "skillJson");
}

async function resolvePlanJsonInput(planJson: string): Promise<string> {
  return resolveJsonFileOrContent(planJson, "planJson");
}

async function deviceApiGet(
  pathname: string
): Promise<
  | { ok: true; text: string }
  | { ok: false; logs: string; status?: number; disconnected?: boolean }
> {
  let logs = "";
  const baseUrl = getDeviceBaseUrl();
  if (!baseUrl) {
    return { ok: false, logs: "KUAIYOU_DEVICE_URL and KUAIYOU_DEVICE_IP are not set.\n" };
  }
  try {
    await ensureDeviceReachable(baseUrl);
    await ensureDevicePaired(baseUrl);
  } catch (e: any) {
    logs += `GET ${baseUrl}/api/mcp/health or POST ${baseUrl}/api/mcp/pair\nHTTP failed: ${e.message}\n`;
    if (e instanceof DeviceDisconnectedError || isDeviceUnreachable(e)) {
      if (!(e instanceof DeviceDisconnectedError)) markDeviceDisconnected();
      return { ok: false, logs, disconnected: true };
    }
    return { ok: false, logs, status: e instanceof HttpStatusError ? e.status : undefined };
  }
  logs += `GET ${baseUrl}${pathname}\n`;
  try {
    const text = await httpGetText(`${baseUrl}${pathname}`);
    return { ok: true, text };
  } catch (e: any) {
    logs += `HTTP failed: ${e.message}\n`;
    if (e instanceof DeviceDisconnectedError || isDeviceUnreachable(e)) {
      markDeviceDisconnected();
      return { ok: false, logs, disconnected: true };
    }
    return { ok: false, logs, status: e instanceof HttpStatusError ? e.status : undefined };
  }
}

/**
 * A 404 means the App build genuinely lacks the route; 401/429 are pairing/rate
 * limits; timeout / connection refused is a stale address — re-pair, don't keep
 * calling the old IP. Reporting a timeout as "not available on this App build"
 * sent people chasing the wrong thing.
 */
function deviceGetFailure(
  toolName: string,
  what: string,
  res: { logs: string; status?: number; disconnected?: boolean }
) {
  if (!getDeviceBaseUrl()) return missingDeviceIp(toolName, res.logs);
  if (res.disconnected) return deviceDisconnectedFailure(res.logs);
  if (res.status === 404) return toolNotImplemented(toolName, res.logs);
  // A status at all means the device answered; only a missing status is a transport failure.
  if (res.status !== undefined) return deviceRejected(what, res.status, "", res.logs);
  return deviceDisconnectedFailure(res.logs);
}

async function deviceApiPost(pathname: string, body: object): Promise<{
  ok: boolean;
  status: number;
  body: string;
  logs: string;
  disconnected?: boolean;
}> {
  return withDeviceLock(async () => {
    const baseUrl = getDeviceBaseUrl();
    let logs = "";
    if (!baseUrl) {
      return { ok: false, status: 0, body: "", logs: "KUAIYOU_DEVICE_URL and KUAIYOU_DEVICE_IP are not set.\n" };
    }
    try {
      await ensureDeviceReachable(baseUrl);
      await ensureDevicePaired(baseUrl);
    } catch (e: any) {
      logs += `GET ${baseUrl}/api/mcp/health or POST ${baseUrl}/api/mcp/pair\nHTTP failed: ${e.message}\n`;
      if (e instanceof DeviceDisconnectedError || isDeviceUnreachable(e)) {
        if (!(e instanceof DeviceDisconnectedError)) markDeviceDisconnected();
        return { ok: false, status: 0, body: "", logs, disconnected: true };
      }
      return {
        ok: false,
        status: e instanceof HttpStatusError ? e.status : 0,
        body: "",
        logs,
      };
    }
    logs += `POST ${baseUrl}${pathname}\n`;
    try {
      const response = await httpPostJson(`${baseUrl}${pathname}`, JSON.stringify(body));
      logs += `HTTP ${response.status} ${response.statusText}\n`;
      if (response.body) logs += `Body: ${response.body.slice(0, 2000)}\n`;
      return { ok: response.ok, status: response.status, body: response.body, logs };
    } catch (e: any) {
      logs += `HTTP failed: ${e.message}\n`;
      if (e instanceof DeviceDisconnectedError || isDeviceUnreachable(e)) {
        markDeviceDisconnected();
        return { ok: false, status: 0, body: "", logs, disconnected: true };
      }
      return { ok: false, status: 0, body: "", logs };
    }
  });
}

async function captureFailureScreenshot(): Promise<FailureScreenshot | undefined> {
  const baseUrl = getDeviceBaseUrl();
  if (!baseUrl) return undefined;
  try {
    await ensureDeviceReachable(baseUrl);
    await ensureDevicePaired(baseUrl);
    const buffer = await httpGetBuffer(`${baseUrl}/api/mcp/screenshot`);
    return { data: buffer.toString("base64"), mimeType: sniffImageMime(buffer) };
  } catch {
    return undefined;
  }
}

function skillDebugLoop(
  skillId: string,
  waited: DebugWaitResult,
  pendingConfirmWaited: boolean,
  extraLogs: string
) {
  const isError =
    waited.outcome === "failed" ||
    waited.outcome === "timeout" ||
    waited.outcome === "disconnected" ||
    waited.outcome === "error";
  const content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  > = [];
  if (waited.screenshot) {
    content.push({
      type: "image",
      data: waited.screenshot.data,
      mimeType: waited.screenshot.mimeType,
    });
  }
  content.push({
    type: "text",
    text: formatDebugLoopText({
      skillId,
      outcome: waited.outcome,
      elapsedMs: waited.elapsedMs,
      statusText: waited.statusText,
      logSummary: waited.logSummary,
      screenshotAttached: Boolean(waited.screenshot),
      screenshotNote: waited.screenshotNote,
      pendingConfirmWaited,
      extraLogs: `${extraLogs}${waited.logs}`,
    }),
  });
  return { content, isError };
}

async function runSkillDebugLoop(
  skillId: string,
  timeoutMs: number,
  waitForConfirm: boolean,
  extraLogs = ""
) {
  const started = await startThenWaitForSkill({
    start: () => deviceApiPost("/api/mcp/run", { skillId }),
    getStatus: () => deviceApiGet(`/api/mcp/status?skillId=${encodeURIComponent(skillId)}`),
    getLog: (limit) => {
      const q = new URLSearchParams({ skillId, limit: String(limit) });
      return deviceApiGet(`/api/mcp/logs?${q.toString()}`);
    },
    getScreenshot: captureFailureScreenshot,
    timeoutMs,
    waitForConfirm,
  });
  if (started.kind === "start-failed") {
    if (started.start.disconnected) {
      return deviceDisconnectedFailure(`${extraLogs}${started.start.logs}`);
    }
    if (started.pendingConfirmWaited && !started.start.ok && started.start.status === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Timed out waiting for phone confirmation before starting ${skillId}.\n` +
              `${PHONE_CONFIRM_NOTICE}\n\nLogs:\n${extraLogs}${started.start.logs}`,
          },
        ],
        isError: true as const,
      };
    }
    return devicePostFailure("run_skill", "start the skill", {
      ...started.start,
      logs: `${extraLogs}${started.start.logs}`,
    });
  }
  if (started.waited.outcome === "disconnected") {
    return deviceDisconnectedFailure(`${extraLogs}${started.waited.logs}`);
  }
  return skillDebugLoop(
    skillId,
    started.waited,
    started.pendingConfirmWaited,
    `${extraLogs}${started.startLogs}`
  );
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "get_kuaiyou_schema": {
      const res = await deviceApiGet("/api/mcp/schema");
      if (!res.ok) {
        return deviceGetFailure(
          "get_kuaiyou_schema",
          "fetch the authoritative skill schema",
          res
        );
      }
      return { content: [{ type: "text", text: res.text }] };
    }

    case "get_kuaiyou_prompts": {
      const res = await deviceApiGet("/api/mcp/prompts");
      if (!res.ok) {
        if (!getDeviceBaseUrl()) return missingDeviceIp("get_kuaiyou_prompts", res.logs);
        if (res.status === 404) {
          return {
            content: [
              {
                type: "text",
                text:
                  "get_kuaiyou_prompts is not available on this App build.\n" +
                  "Please upgrade 快游大师 so GET /api/mcp/prompts exists.\n" +
                  "Do not use any prompt text bundled in this CLI or Skill repo.\n" +
                  (res.logs || ""),
              },
            ],
            isError: true,
          };
        }
        return deviceGetFailure(
          "get_kuaiyou_prompts",
          "fetch generation prompts from the App",
          res
        );
      }
      return { content: [{ type: "text", text: res.text }] };
    }

    case "pair_device": {
      const args =
        (request.params.arguments as {
          connectionInfo?: string;
          host?: string;
          port?: string | number;
          code?: string;
          deviceLabel?: string;
        }) || {};
      const connection = mergeConnectionInfo(parseConnectionInfo(args.connectionInfo), {
        host: args.host,
        port: args.port,
        code: args.code,
        deviceLabel: args.deviceLabel,
      });

      let sessionOverrideApplied = false;
      try {
        if (connection.address) {
          setSessionDeviceOverride({ baseUrl: addressToBaseUrl(connection.address) });
          sessionOverrideApplied = true;
        }
        if (connection.pairingCode) {
          setSessionDeviceOverride({ pairingCode: connection.pairingCode });
          sessionOverrideApplied = true;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid address in connectionInfo/host: ${detail}`
        );
      }

      const baseUrl = getDeviceBaseUrl();
      if (!baseUrl) {
        return {
          content: [
            {
              type: "text",
              text:
                `pair_device needs a device address.\n` +
                `Pass connectionInfo (App「复制给 Agent」全文) or structured host/port, ` +
                `or set KUAIYOU_DEVICE_IP / KUAIYOU_DEVICE_URL in mcp.json and reload MCP.`,
            },
          ],
          isError: true,
        };
      }
      let logs = `POST ${baseUrl}/api/mcp/pair\n`;
      try {
        await ensureDeviceReachable(baseUrl);
        clearDevicePairingSession();
        const paired = await ensureDevicePaired(baseUrl);
        logs += paired.legacyNoPairRoute
          ? "paired=compat (HTTP 404 /pair)\n"
          : `paired=true bodyBytes=${paired.body.length}\n`;
        const ack = parsePairAck(paired.body);
        const persistResult = persistPairedDevice({
          baseUrl,
          pairingCode:
            connection.pairingCode ||
            process.env.KUAIYOU_MCP_PAIRING_CODE ||
            process.env.KUAIYOU_MCP_TOKEN,
        });
        if (persistResult.ok) {
          logs += `persisted=${persistResult.path}\n`;
        } else {
          logs += `persistFailed=${persistResult.error}\n`;
        }
        return {
          content: [
            {
              type: "text",
              text: formatPairSuccessMessage({
                ack,
                connection,
                configuredEndpoint: baseUrl.replace(/^https?:\/\//, ""),
                logs,
                legacyNoPairRoute: paired.legacyNoPairRoute,
                sessionOverrideApplied,
                persistResult,
              }),
            },
          ],
        };
      } catch (e: any) {
        logs += `HTTP failed: ${e.message}\n`;
        if (e instanceof DeviceDisconnectedError || isDeviceUnreachable(e)) {
          return noteUnreachableAndFail(e, logs);
        }
        if (e instanceof HttpStatusError) {
          return deviceRejected("pair", e.status, "", logs);
        }
        return deviceHttpFailure("pair", logs);
      }
    }

    case "validate_kuaiyou_skill": {
      const { skillJson } = request.params.arguments as any;
      if (!skillJson) {
        throw new McpError(ErrorCode.InvalidParams, "skillJson is required");
      }

      const content = await resolveSkillJsonInput(skillJson);
      const parsed = validateSkillPayload(content);
      if (parsed.parsed === null || parsed.errors.length > 0) {
        return {
          content: [{ type: "text", text: formatLintResult(parsed) }],
          isError: true,
        };
      }

      const contract = await loadDeviceContract("validate_kuaiyou_skill");
      if (!contract.ok) return contract.response;

      const result = validateSkillPayload(parsed.parsed, contract.validator);
      return {
        content: [{ type: "text", text: formatLintResult(result) }],
        isError: !result.ok,
      };
    }

    case "push_reactive_skill": {
      const { skillId, skillJson, run, timeoutMs } = request.params.arguments as any;
      if (!skillId || !skillJson) {
        throw new McpError(ErrorCode.InvalidParams, "skillId and skillJson are required");
      }
      if (typeof skillId !== "string" || !SKILL_ID_PATTERN.test(skillId)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "skillId must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ (no path separators or shell metacharacters)"
        );
      }
      const runAfterPush = asBool(run) === true;
      let waitTimeoutMs = 90_000;
      try {
        waitTimeoutMs = resolveWaitTimeoutMs(timeoutMs);
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidParams,
          error instanceof Error ? error.message : String(error)
        );
      }

      const content = await resolveSkillJsonInput(skillJson);
      const parsed = validateSkillPayload(content);
      if (parsed.parsed === null || parsed.errors.length > 0) {
        return {
          content: [{ type: "text", text: `Refusing to deploy — ${formatLintResult(parsed)}` }],
          isError: true,
        };
      }

      const contract = await loadDeviceContract("push_reactive_skill");
      if (!contract.ok) return contract.response;

      const lint = validateSkillPayload(parsed.parsed, contract.validator);
      if (!lint.ok) {
        return {
          content: [{ type: "text", text: `Refusing to deploy — ${formatLintResult(lint)}` }],
          isError: true,
        };
      }

      let processedObj: any =
        lint.parsed && typeof lint.parsed === "object" ? structuredClone(lint.parsed) : JSON.parse(content);
      delete processedObj.agentId;
      if (processedObj.id !== skillId) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `skillId argument "${skillId}" does not match skillJson.id "${String(processedObj.id)}"`
        );
      }
      const processedJson = JSON.stringify(processedObj, null, 2);

      const baseUrl = getDeviceBaseUrl();
      let logs = "";
      if (lint.warnings.length > 0) {
        logs += `Warnings:\n${lint.warnings.map((w) => `- ${w}`).join("\n")}\n\n`;
      }

      if (!baseUrl) return missingDeviceIp("push_reactive_skill", logs);

      logs += `Attempting HTTP POST to ${baseUrl}/api/mcp/import...\n`;
      const deployed = await withDeviceLock(async () => {
        try {
          await ensureDeviceReachable(baseUrl);
          await ensureDevicePaired(baseUrl);
          let response = await httpPostJson(`${baseUrl}/api/mcp/import`, processedJson);
          // Backward-compatible fallback for older App builds that still expect form posts.
          if (response.status === 415 || response.status === 400) {
            const formData = new URLSearchParams();
            formData.append("postData", processedJson);
            response = await httpPostForm(`${baseUrl}/api/mcp/import`, formData);
          }

          if (response.ok) {
            logs += `HTTP push successful!\n`;
            if (response.body) logs += `Device response: ${response.body.slice(0, 2000)}\n`;
            return {
              ok: true as const,
              body: response.body ?? "",
            };
          }
          logs += `HTTP response not ok: ${response.status} ${response.statusText}\n`;
          if (response.body) logs += `Device response: ${response.body.slice(0, 2000)}\n`;
          return {
            ok: false as const,
            response: deviceRejected("deploy the skill", response.status, response.body ?? "", logs),
          };
        } catch (e: any) {
          logs += `HTTP push failed: ${e.message}\n`;
          if (e instanceof DeviceDisconnectedError || isDeviceUnreachable(e)) {
            return { ok: false as const, response: noteUnreachableAndFail(e, logs) };
          }
          if (e instanceof HttpStatusError) {
            return {
              ok: false as const,
              response: deviceRejected("deploy the skill", e.status, "", logs),
            };
          }
        }

        return { ok: false as const, response: deviceHttpFailure("deploy the skill", logs) };
      });

      if (!deployed.ok) return deployed.response;

      if (!runAfterPush) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully deployed skill ${skillId} via HTTP!\n\nLogs:\n${logs}`,
            },
          ],
        };
      }

      return runSkillDebugLoop(skillId, waitTimeoutMs, true, logs);
    }

    case "observe_screen": {
      let logs = "";
      const baseUrl = getDeviceBaseUrl();
      if (!baseUrl) return missingDeviceIp("observe_screen", logs);

      logs += `GET ${baseUrl}/api/mcp/ui_tree and /api/mcp/screenshot\n`;
      try {
        await ensureDeviceReachable(baseUrl);
        await ensureDevicePaired(baseUrl);
        const [treeResult, shotResult] = await Promise.allSettled([
          httpGetText(`${baseUrl}/api/mcp/ui_tree`),
          httpGetBuffer(`${baseUrl}/api/mcp/screenshot`),
        ]);

        if (treeResult.status === "rejected") {
          const err = treeResult.reason;
          logs += `ui_tree failed: ${err instanceof Error ? err.message : String(err)}\n`;
          if (err instanceof DeviceDisconnectedError || isDeviceUnreachable(err)) {
            return noteUnreachableAndFail(err, logs);
          }
          if (err instanceof HttpStatusError) {
            return deviceRejected("observe the screen", err.status, "", logs);
          }
          return deviceHttpFailure("observe the screen", logs);
        }

        let screenshotNote: string | undefined;
        if (shotResult.status === "rejected") {
          const detail =
            shotResult.reason instanceof Error ? shotResult.reason.message : String(shotResult.reason);
          logs += `screenshot failed: ${detail}\n`;
          screenshotNote = `Screenshot unavailable (${detail}). Interactive nodes are still listed below.`;
        }

        let summaryText: string;
        try {
          summaryText = formatObserveSummary(summarizeScreenTree(JSON.parse(treeResult.value)), screenshotNote);
        } catch {
          summaryText =
            (screenshotNote ? `${screenshotNote}\n` : "") +
            "Screen observation: UI tree was not valid JSON; raw payload follows.\n\n" +
            treeResult.value.slice(0, 8000);
        }

        const content: Array<
          { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
        > = [];
        if (shotResult.status === "fulfilled") {
          content.push({
            type: "image",
            data: shotResult.value.toString("base64"),
            mimeType: sniffImageMime(shotResult.value),
          });
        }
        content.push({ type: "text", text: summaryText + `\n\nLogs:\n${logs}` });
        return { content };
      } catch (e: any) {
        logs += `HTTP fetch failed: ${e.message}\n`;
        if (e instanceof DeviceDisconnectedError || isDeviceUnreachable(e)) {
          return noteUnreachableAndFail(e, logs);
        }
        if (e instanceof HttpStatusError) {
          return deviceRejected("observe the screen", e.status, "", logs);
        }
      }

      return deviceHttpFailure("observe the screen", logs);
    }

    case "get_ui_tree": {
      let logs = "";
      const baseUrl = getDeviceBaseUrl();

      if (!baseUrl) return missingDeviceIp("get_ui_tree", logs);

      logs += `Attempting HTTP GET to ${baseUrl}/api/mcp/ui_tree...\n`;
      try {
        await ensureDeviceReachable(baseUrl);
        await ensureDevicePaired(baseUrl);
        const jsonText = await httpGetText(`${baseUrl}/api/mcp/ui_tree`);
        try {
          const parsedJson = JSON.parse(jsonText);
          const enhancedJson = enhanceUiNodes(parsedJson);
          return {
            content: [{ type: "text", text: JSON.stringify(enhancedJson, null, 2) }],
          };
        } catch (e) {
          return {
            content: [{ type: "text", text: jsonText }],
          };
        }
      } catch (e: any) {
        logs += `HTTP fetch failed: ${e.message}\n`;
        if (e instanceof DeviceDisconnectedError || isDeviceUnreachable(e)) {
          return noteUnreachableAndFail(e, logs);
        }
        if (e instanceof HttpStatusError) {
          return deviceRejected("fetch the screen nodes", e.status, "", logs);
        }
      }

      return deviceHttpFailure("fetch the screen nodes", logs);
    }

    case "capture_screenshot": {
      let logs = "";
      const baseUrl = getDeviceBaseUrl();

      if (!baseUrl) return missingDeviceIp("capture_screenshot", logs);

      logs += `Attempting HTTP GET to ${baseUrl}/api/mcp/screenshot...\n`;
      try {
        await ensureDeviceReachable(baseUrl);
        await ensureDevicePaired(baseUrl);
        const buffer = await httpGetBuffer(`${baseUrl}/api/mcp/screenshot`);
        const base64 = buffer.toString("base64");
        return {
          content: [
            {
              type: "image",
              data: base64,
              mimeType: sniffImageMime(buffer),
            },
          ],
        };
      } catch (e: any) {
        logs += `HTTP fetch failed: ${e.message}\n`;
        if (e instanceof DeviceDisconnectedError || isDeviceUnreachable(e)) {
          return noteUnreachableAndFail(e, logs);
        }
        if (e instanceof HttpStatusError) {
          return deviceRejected("capture the screenshot", e.status, "", logs);
        }
      }

      return deviceHttpFailure("capture the screenshot", logs);
    }

    case "list_skills": {
      const res = await deviceApiGet("/api/mcp/skills");
      if (!res.ok) {
        return deviceGetFailure("list_skills", "list the skills on the device", res);
      }
      return { content: [{ type: "text", text: res.text }] };
    }

    case "delete_skill": {
      const { skillId } = request.params.arguments as any;
      if (!skillId || !SKILL_ID_PATTERN.test(skillId)) {
        throw new McpError(ErrorCode.InvalidParams, "valid skillId is required");
      }
      const res = await deviceApiPost("/api/mcp/skills/delete", { skillId });
      if (!res.ok) {
        return devicePostFailure("delete_skill", "delete the skill", res);
      }
      return { content: [{ type: "text", text: res.body || `Deleted ${skillId}` }] };
    }

    case "run_skill": {
      const { skillId, wait, timeoutMs } = request.params.arguments as any;
      if (!skillId || !SKILL_ID_PATTERN.test(skillId)) {
        throw new McpError(ErrorCode.InvalidParams, "valid skillId is required");
      }
      const waitEnabled = asBool(wait) === true;
      let waitTimeoutMs = 90_000;
      try {
        waitTimeoutMs = resolveWaitTimeoutMs(timeoutMs);
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidParams,
          error instanceof Error ? error.message : String(error)
        );
      }
      if (!waitEnabled) {
        const res = await deviceApiPost("/api/mcp/run", { skillId });
        if (!res.ok) {
          return devicePostFailure("run_skill", "start the skill", res);
        }
        return { content: [{ type: "text", text: res.body || `Started ${skillId}` }] };
      }
      return runSkillDebugLoop(skillId, waitTimeoutMs, false);
    }

    case "stop_skill": {
      const { skillId } = (request.params.arguments as any) || {};
      if (skillId !== undefined && (typeof skillId !== "string" || !SKILL_ID_PATTERN.test(skillId))) {
        throw new McpError(ErrorCode.InvalidParams, "skillId must be valid when provided");
      }
      const res = await deviceApiPost("/api/mcp/stop", skillId ? { skillId } : {});
      if (!res.ok) {
        return devicePostFailure("stop_skill", "stop the running skill", res);
      }
      return { content: [{ type: "text", text: res.body || "Stop requested" }] };
    }

    case "get_skill_status": {
      const { skillId } = request.params.arguments as any;
      if (!skillId || !SKILL_ID_PATTERN.test(skillId)) {
        throw new McpError(ErrorCode.InvalidParams, "valid skillId is required");
      }
      const res = await deviceApiGet(`/api/mcp/status?skillId=${encodeURIComponent(skillId)}`);
      if (!res.ok) {
        return deviceGetFailure("get_skill_status", "read the skill status", res);
      }
      return { content: [{ type: "text", text: res.text }] };
    }

    case "get_execution_log": {
      const { skillId, limit } = request.params.arguments as any;
      if (!skillId || !SKILL_ID_PATTERN.test(skillId)) {
        throw new McpError(ErrorCode.InvalidParams, "valid skillId is required");
      }
      const normalizedLimit = limit ?? 100;
      if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 1000) {
        throw new McpError(ErrorCode.InvalidParams, "limit must be an integer between 1 and 1000");
      }
      const q = new URLSearchParams({ skillId, limit: String(normalizedLimit) });
      const res = await deviceApiGet(`/api/mcp/logs?${q.toString()}`);
      if (!res.ok) {
        return deviceGetFailure("get_execution_log", "read the execution log", res);
      }
      return { content: [{ type: "text", text: res.text }] };
    }

    case "plans_schema": {
      const res = await deviceApiGet(PLAN_SCHEMA_PATH);
      if (!res.ok) {
        return deviceGetFailure(
          "plans_schema",
          "fetch the authoritative learning-plan schema",
          res
        );
      }
      return { content: [{ type: "text", text: res.text }] };
    }

    case "plans_list": {
      const res = await deviceApiGet("/api/mcp/plans");
      if (!res.ok) {
        return deviceGetFailure("plans_list", "list the learning plans on the device", res);
      }
      return { content: [{ type: "text", text: res.text }] };
    }

    case "plans_get": {
      const { planId } = request.params.arguments as any;
      if (!planId || typeof planId !== "string" || !PLAN_ID_PATTERN.test(planId)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "planId must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"
        );
      }
      const res = await deviceApiGet(`/api/mcp/plans/${encodeURIComponent(planId)}`);
      if (!res.ok) {
        return deviceGetFailure("plans_get", "fetch the learning plan", res);
      }
      return { content: [{ type: "text", text: res.text }] };
    }

    case "plans_validate": {
      const { planJson } = request.params.arguments as any;
      if (!planJson) {
        throw new McpError(ErrorCode.InvalidParams, "planJson is required");
      }

      const content = await resolvePlanJsonInput(planJson);
      const parsed = validatePlanPayload(content);
      if (parsed.parsed === null || parsed.errors.length > 0) {
        return {
          content: [{ type: "text", text: formatPlanLintResult(parsed) }],
          isError: true,
        };
      }

      const contract = await loadDeviceContract("plans_validate", PLAN_SCHEMA_PATH, "learning-plan");
      if (!contract.ok) return contract.response;

      const schemaResult = validatePlanPayload(parsed.parsed, contract.validator);
      if (!schemaResult.ok) {
        return {
          content: [{ type: "text", text: formatPlanLintResult(schemaResult) }],
          isError: true,
        };
      }

      const body =
        schemaResult.parsed && typeof schemaResult.parsed === "object"
          ? schemaResult.parsed
          : JSON.parse(content);
      const res = await deviceApiPost("/api/mcp/plans/validate", body as object);
      if (!res.ok) {
        return devicePostFailure("plans_validate", "validate the learning plan", res);
      }
      const parts = [formatPlanLintResult(schemaResult)];
      if (res.body.trim()) {
        parts.push("", "Device validate response:", res.body.slice(0, 2000));
      }
      return { content: [{ type: "text", text: parts.join("\n") }] };
    }

    case "plans_deploy": {
      const { planJson } = request.params.arguments as any;
      if (!planJson) {
        throw new McpError(ErrorCode.InvalidParams, "planJson is required");
      }

      const content = await resolvePlanJsonInput(planJson);
      const parsed = validatePlanPayload(content);
      if (parsed.parsed === null || parsed.errors.length > 0) {
        return {
          content: [{ type: "text", text: `Refusing to deploy — ${formatPlanLintResult(parsed)}` }],
          isError: true,
        };
      }

      const contract = await loadDeviceContract("plans_deploy", PLAN_SCHEMA_PATH, "learning-plan");
      if (!contract.ok) return contract.response;

      const lint = validatePlanPayload(parsed.parsed, contract.validator);
      if (!lint.ok) {
        return {
          content: [{ type: "text", text: `Refusing to deploy — ${formatPlanLintResult(lint)}` }],
          isError: true,
        };
      }

      const planObj =
        lint.parsed && typeof lint.parsed === "object" ? (lint.parsed as Record<string, unknown>) : null;
      if (!planObj || typeof planObj.id !== "string" || !PLAN_ID_PATTERN.test(planObj.id)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "planJson.id must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"
        );
      }
      const planId = planObj.id;

      let prefix = "";
      if (lint.warnings.length > 0) {
        prefix = `Warnings:\n${lint.warnings.map((w) => `- ${w}`).join("\n")}\n\n`;
      }

      const res = await deviceApiPost("/api/mcp/plans", planObj);
      if (!res.ok) {
        return devicePostFailure("plans_deploy", "deploy the learning plan", {
          ...res,
          logs: prefix + res.logs,
        });
      }
      const deviceBody = res.body.trim() ? `\n\nDevice response:\n${res.body.slice(0, 2000)}` : "";
      return {
        content: [
          {
            type: "text",
            text:
              `${prefix}Successfully queued learning plan ${planId} for import.\n` +
              `The device should return pendingConfirm=true — ask the user to confirm on the phone ` +
              `before the plan appears in 领域教练. Same id overwrites outline and progress.` +
              `${deviceBody}\n\nLogs:\n${res.logs}`,
          },
        ],
      };
    }

    case "plans_delete": {
      const { planId } = request.params.arguments as any;
      if (!planId || typeof planId !== "string" || !PLAN_ID_PATTERN.test(planId)) {
        throw new McpError(ErrorCode.InvalidParams, "valid planId is required");
      }
      const res = await deviceApiPost("/api/mcp/plans/delete", { planId });
      if (!res.ok) {
        return devicePostFailure("plans_delete", "delete the learning plan", res);
      }
      return { content: [{ type: "text", text: res.body || `Deleted ${planId}` }] };
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Kuaiyou MCP server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
