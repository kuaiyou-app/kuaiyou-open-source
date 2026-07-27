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
import {
  HttpStatusError,
  httpGetText,
  httpGetBuffer,
  httpPostJson,
  httpPostForm,
  sniffImageMime,
} from "./device.js";

dotenv.config();

// skillId is interpolated into a device-side file path, so restrict it to a
// conservative charset. This blocks path traversal (../) and shell metacharacters
// even though device calls no longer go through a shell.
const SKILL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const server = new Server(
  {
    name: "autoace-cli",
    version: "1.0.4",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const getDeviceIp = () => process.env.KUAIYOU_DEVICE_IP;
const getDeviceBaseUrl = (ip: string) => {
  return /:\d+$/.test(ip) ? `http://${ip}` : `http://${ip}:8080`;
};

// The CLI talks to the device over the LAN HTTP channel only. These two
// helpers keep the "no device" and "device unreachable" messages consistent
// across every tool instead of repeating the guidance inline.
function missingDeviceIp(toolName: string, logs = "") {
  return {
    content: [
      {
        type: "text",
        text:
          `${toolName} needs a device address.\n` +
          `Set KUAIYOU_DEVICE_IP to the "ip:port" shown by the App under ` +
          `设置 → 高级设置 → MCP 服务, and KUAIYOU_MCP_PAIRING_CODE to the pairing code.` +
          (logs ? `\n\nLogs:\n${logs}` : ""),
      },
    ],
    isError: true,
  };
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
function deviceRejected(what: string, status: number, body: string, logs: string) {
  // Keyed by status rather than a nested ternary: these hints get edited often
  // and the ternary chain had already picked up a duplicated branch.
  const hints: Record<number, string> = {
    401: `The pairing code was rejected. It is regenerated every time the MCP service restarts — copy the current one from the App.`,
    403: `The device refused the request origin or host. Point KUAIYOU_DEVICE_IP at the exact address the App shows.`,
    404: `The device has no such route or resource (an older App build, or the skill id does not exist).`,
    409: `The device refused to store this: usually the skill quota is full. Delete an unused skill (delete_skill) or upgrade, then push again.`,
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
        type: "text",
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
  res: { status: number; body: string; logs: string }
) {
  if (!getDeviceIp()) return missingDeviceIp(toolName, res.logs);
  if (res.status === 404) return deviceRejected(what, 404, res.body, res.logs);
  if (res.status > 0) return deviceRejected(what, res.status, res.body, res.logs);
  return deviceHttpFailure(what, res.logs);
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

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "validate_kuaiyou_skill",
        description:
          "Validate a JSON string or .json file path against the Kuaiyou skill schema (Zod + business lint).",
        inputSchema: {
          type: "object",
          properties: {
            skillJson: {
              type: "string",
              description: "The JSON content or absolute .json file path to validate.",
            },
          },
          required: ["skillJson"],
        },
      },
      {
        name: "push_reactive_skill",
        description:
          "Validate then deploy a skill JSON to the device over the LAN HTTP channel (requires App /api/mcp/import).",
        inputSchema: {
          type: "object",
          properties: {
            skillId: {
              type: "string",
              description: "The ID of the skill.",
            },
            skillJson: {
              type: "string",
              description: "The JSON content to deploy.",
            },
          },
          required: ["skillId", "skillJson"],
        },
      },
      {
        name: "get_ui_tree",
        description:
          "Fetch the current UI node tree from the device over the LAN HTTP channel (requires App /api/mcp/ui_tree).",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "capture_screenshot",
        description:
          "Fetch the current screen screenshot from the device over the LAN HTTP channel (requires App /api/mcp/screenshot).",
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
        description: "Start executing a skill on the device (requires App /api/mcp/run).",
        inputSchema: {
          type: "object",
          properties: {
            skillId: { type: "string" },
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
            limit: { type: "number", description: "Max log lines (default 100)." },
          },
          required: ["skillId"],
        },
      },
    ],
  };
});

function parseBoundsStr(boundsStr: string) {
  const match = boundsStr.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (match) {
    const left = parseInt(match[1], 10);
    const top = parseInt(match[2], 10);
    const right = parseInt(match[3], 10);
    const bottom = parseInt(match[4], 10);
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      centerX: Math.floor((left + right) / 2),
      centerY: Math.floor((top + bottom) / 2),
    };
  }
  return boundsStr;
}

function enhanceUiNodes(data: any): any {
  if (Array.isArray(data)) {
    return data.map(enhanceUiNodes);
  } else if (data !== null && typeof data === "object") {
    const newData: any = {};
    for (const key in data) {
      if (key === "bounds" && typeof data[key] === "string") {
        newData[key] = parseBoundsStr(data[key]);
      } else {
        newData[key] = enhanceUiNodes(data[key]);
      }
    }
    return newData;
  }
  return data;
}


async function resolveSkillJsonInput(skillJson: string): Promise<string> {
  // Only treat as a file path when it looks like one and ends with .json.
  const looksLikePath =
    skillJson.endsWith(".json") &&
    (skillJson.startsWith("/") ||
      skillJson.startsWith("./") ||
      skillJson.startsWith("../") ||
      /^[A-Za-z]:[\\/]/.test(skillJson));
  if (!looksLikePath) return skillJson;

  try {
    const stat = await fs.stat(skillJson);
    if (!stat.isFile()) {
      throw new McpError(ErrorCode.InvalidParams, `skillJson path is not a file: ${skillJson}`);
    }
    if (!skillJson.toLowerCase().endsWith(".json")) {
      throw new McpError(ErrorCode.InvalidParams, "File path skillJson must end with .json");
    }
    return await fs.readFile(skillJson, "utf8");
  } catch (e: any) {
    if (e instanceof McpError) throw e;
    // Path-looking string that does not exist: fall through as JSON body.
    return skillJson;
  }
}

async function deviceApiGet(
  pathname: string
): Promise<{ ok: true; text: string } | { ok: false; logs: string; status?: number }> {
  const ip = getDeviceIp();
  let logs = "";
  if (!ip) {
    return { ok: false, logs: "KUAIYOU_DEVICE_IP is not set.\n" };
  }
  const baseUrl = getDeviceBaseUrl(ip);
  logs += `GET ${baseUrl}${pathname}\n`;
  try {
    const text = await httpGetText(`${baseUrl}${pathname}`);
    return { ok: true, text };
  } catch (e: any) {
    logs += `HTTP failed: ${e.message}\n`;
    return { ok: false, logs, status: e instanceof HttpStatusError ? e.status : undefined };
  }
}

/**
 * A 404 means the App build genuinely lacks the route; anything else (timeout,
 * connection refused, 401) is a channel/config problem. Reporting a timeout as
 * "not available on this App build" sent people chasing the wrong thing.
 */
function deviceGetFailure(toolName: string, what: string, res: { logs: string; status?: number }) {
  if (!getDeviceIp()) return missingDeviceIp(toolName, res.logs);
  if (res.status === 404) return toolNotImplemented(toolName, res.logs);
  // A status at all means the device answered; only a missing status is a transport failure.
  if (res.status !== undefined) return deviceRejected(what, res.status, "", res.logs);
  return deviceHttpFailure(what, res.logs);
}

async function deviceApiPost(pathname: string, body: object): Promise<{ ok: boolean; status: number; body: string; logs: string }> {
  const ip = getDeviceIp();
  let logs = "";
  if (!ip) {
    return { ok: false, status: 0, body: "", logs: "KUAIYOU_DEVICE_IP is not set.\n" };
  }
  const baseUrl = getDeviceBaseUrl(ip);
  logs += `POST ${baseUrl}${pathname}\n`;
  try {
    const response = await httpPostJson(`${baseUrl}${pathname}`, JSON.stringify(body));
    logs += `HTTP ${response.status} ${response.statusText}\n`;
    if (response.body) logs += `Body: ${response.body.slice(0, 2000)}\n`;
    return { ok: response.ok, status: response.status, body: response.body, logs };
  } catch (e: any) {
    logs += `HTTP failed: ${e.message}\n`;
    return { ok: false, status: 0, body: "", logs };
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "validate_kuaiyou_skill": {
      const { skillJson } = request.params.arguments as any;
      if (!skillJson) {
        throw new McpError(ErrorCode.InvalidParams, "skillJson is required");
      }

      const content = await resolveSkillJsonInput(skillJson);
      const result = validateSkillPayload(content);
      return {
        content: [{ type: "text", text: formatLintResult(result) }],
        isError: !result.ok,
      };
    }

    case "push_reactive_skill": {
      const { skillId, skillJson } = request.params.arguments as any;
      if (!skillId || !skillJson) {
        throw new McpError(ErrorCode.InvalidParams, "skillId and skillJson are required");
      }
      if (typeof skillId !== "string" || !SKILL_ID_PATTERN.test(skillId)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "skillId must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ (no path separators or shell metacharacters)"
        );
      }

      const lint = validateSkillPayload(skillJson);
      if (!lint.ok) {
        return {
          content: [{ type: "text", text: `Refusing to deploy — ${formatLintResult(lint)}` }],
          isError: true,
        };
      }

      let processedObj: any =
        lint.parsed && typeof lint.parsed === "object" ? structuredClone(lint.parsed) : JSON.parse(skillJson);
      delete processedObj.agentId;
      const processedJson = JSON.stringify(processedObj, null, 2);

      const ip = getDeviceIp();
      let logs = "";
      if (lint.warnings.length > 0) {
        logs += `Warnings:\n${lint.warnings.map((w) => `- ${w}`).join("\n")}\n\n`;
      }

      if (!ip) return missingDeviceIp("push_reactive_skill", logs);

      const baseUrl = getDeviceBaseUrl(ip);
      logs += `Attempting HTTP POST to ${baseUrl}/api/mcp/import...\n`;
      try {
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
            content: [{ type: "text", text: `Successfully deployed skill ${skillId} via HTTP!\n\nLogs:\n${logs}` }],
          };
        }
        logs += `HTTP response not ok: ${response.status} ${response.statusText}\n`;
        if (response.body) logs += `Device response: ${response.body.slice(0, 2000)}\n`;
        // The device answered — this is a rejection, not a broken channel.
        return deviceRejected("deploy the skill", response.status, response.body ?? "", logs);
      } catch (e: any) {
        logs += `HTTP push failed: ${e.message}\n`;
      }

      return deviceHttpFailure("deploy the skill", logs);
    }

    case "get_ui_tree": {
      const ip = getDeviceIp();
      let logs = "";

      if (!ip) return missingDeviceIp("get_ui_tree", logs);

      const baseUrl = getDeviceBaseUrl(ip);
      logs += `Attempting HTTP GET to ${baseUrl}/api/mcp/ui_tree...\n`;
      try {
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
        // A status means the device answered and refused; no status means transport.
        if (e instanceof HttpStatusError) {
          return deviceRejected("fetch the screen nodes", e.status, "", logs);
        }
      }

      return deviceHttpFailure("fetch the screen nodes", logs);
    }

    case "capture_screenshot": {
      const ip = getDeviceIp();
      let logs = "";

      if (!ip) return missingDeviceIp("capture_screenshot", logs);

      const baseUrl = getDeviceBaseUrl(ip);
      logs += `Attempting HTTP GET to ${baseUrl}/api/mcp/screenshot...\n`;
      try {
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
        // A status means the device answered and refused; no status means transport.
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
      const { skillId } = request.params.arguments as any;
      if (!skillId || !SKILL_ID_PATTERN.test(skillId)) {
        throw new McpError(ErrorCode.InvalidParams, "valid skillId is required");
      }
      const res = await deviceApiPost("/api/mcp/run", { skillId });
      if (!res.ok) {
        return devicePostFailure("run_skill", "start the skill", res);
      }
      return { content: [{ type: "text", text: res.body || `Started ${skillId}` }] };
    }

    case "stop_skill": {
      const { skillId } = (request.params.arguments as any) || {};
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
      const q = new URLSearchParams({ skillId, limit: String(limit ?? 100) });
      const res = await deviceApiGet(`/api/mcp/logs?${q.toString()}`);
      if (!res.ok) {
        return deviceGetFailure("get_execution_log", "read the execution log", res);
      }
      return { content: [{ type: "text", text: res.text }] };
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
