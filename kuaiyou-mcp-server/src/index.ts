import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { XMLParser } from "fast-xml-parser";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as dotenv from "dotenv";
import crypto from "crypto";
import { formatLintResult, validateSkillPayload } from "./skill-lint.js";
import {
  runAdb,
  captureScreencap,
  httpGetText,
  httpGetBuffer,
  httpPostJson,
  httpPostForm,
  withDeviceLock,
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
    version: "1.0.1",
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
          "Validate then deploy a skill JSON to a connected Android device via HTTP LAN (fallback to ADB public Download path).",
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
          "Fetch the current UI node tree from the connected Android device via HTTP (fallback to ADB uiautomator with hierarchy).",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "capture_screenshot",
        description:
          "Fetch the current screen screenshot from the connected Android device via HTTP (fallback to ADB screencap).",
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

function xmlNodeToTree(node: any): any {
  if (!node) return null;
  if (Array.isArray(node)) {
    return node.map(xmlNodeToTree).filter(Boolean);
  }

  const childrenRaw = node.node;
  const children = childrenRaw ? xmlNodeToTree(childrenRaw) : undefined;
  const childList = children === undefined ? undefined : Array.isArray(children) ? children : [children];

  const info: any = {};
  if (node["@_class"]) info.class = node["@_class"];
  if (node["@_text"]) info.text = node["@_text"];
  if (node["@_content-desc"]) info["content-desc"] = node["@_content-desc"];
  if (node["@_resource-id"]) {
    info["resource-id"] = node["@_resource-id"];
    info.viewId = node["@_resource-id"];
  }
  if (node["@_package"]) info.package = node["@_package"];
  if (node["@_bounds"]) {
    info.bounds =
      typeof node["@_bounds"] === "string" ? parseBoundsStr(node["@_bounds"]) : node["@_bounds"];
  }
  if (node["@_clickable"] !== undefined) info.clickable = node["@_clickable"] === "true";
  if (node["@_scrollable"] !== undefined) info.scrollable = node["@_scrollable"] === "true";
  if (node["@_enabled"] !== undefined) info.enabled = node["@_enabled"] === "true";
  if (node["@_checked"] !== undefined) info.checked = node["@_checked"] === "true";
  if (childList && childList.length > 0) info.children = childList;

  const interesting =
    info.clickable ||
    info.text ||
    info["content-desc"] ||
    info.viewId ||
    info.scrollable ||
    (childList && childList.length > 0);
  if (!interesting) {
    return childList && childList.length === 1 ? childList[0] : childList && childList.length > 1 ? { children: childList } : null;
  }
  return info;
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

async function deviceApiGet(pathname: string): Promise<{ ok: true; text: string } | { ok: false; logs: string }> {
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
    return { ok: false, logs };
  }
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

      if (ip) {
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
          } else {
            logs += `HTTP response not ok: ${response.status} ${response.statusText}\n`;
            if (response.body) logs += `Device response: ${response.body.slice(0, 2000)}\n`;
          }
        } catch (e: any) {
          logs += `HTTP push failed: ${e.message}\n`;
        }
      }

      logs += `\nFalling back to ADB...\n`;
      return withDeviceLock(async () => {
        let tempDir: string | undefined;
        try {
          tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kuaiyou-"));
          const tempPath = path.join(tempDir, `${crypto.randomUUID()}.json`);
          await fs.writeFile(tempPath, processedJson, "utf8");

          // Prefer app-specific external files (readable by the app under scoped storage).
          // /sdcard/Download/kuaiyou is NOT reliably readable by the app on Android 11+.
          const packageName = getPackageName();
          await runAdb(["shell", "mkdir", "-p", `/sdcard/Android/data/${packageName}/files`]);
          const targetPath = `/sdcard/Android/data/${packageName}/files/${skillId}.json`;

          const { stdout: pushOut, stderr: pushErr } = await runAdb(["push", tempPath, targetPath]);
          logs += `[ADB PUSH]\n${pushOut}\n${pushErr}\n`;

          const { stdout: chmodOut, stderr: chmodErr } = await runAdb(["shell", "chmod", "666", targetPath]);
          logs += `[ADB CHMOD]\n${chmodOut}\n${chmodErr}\n`;

          const deepLink = `kuaiyou://import_skill?path=${encodeURIComponent(targetPath)}`;
          const { stdout: amOut, stderr: amErr } = await runAdb([
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            deepLink,
          ]);
          logs += `[ADB AM START]\n${amOut}\n${amErr}\n`;

          return {
            content: [
              {
                type: "text",
                text: `Successfully deployed skill ${skillId} to device via ADB!\n\nLogs:\n${logs}`,
              },
            ],
          };
        } catch (e: any) {
          logs += `ADB deploy failed: ${e.message}\n`;
          return {
            content: [
              {
                type: "text",
                text:
                  `Failed to deploy to device.\nMake sure you have enabled "LAN MCP service" in the App (if using IP) or connected via USB (if using ADB).\n\nLogs:\n${logs}`,
              },
            ],
            isError: true,
          };
        } finally {
          if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
          }
        }
      });
    }

    case "get_ui_tree": {
      const ip = getDeviceIp();
      let logs = "";

      if (ip) {
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
        }
      }

      logs += `\nFalling back to ADB uiautomator dump...\n`;
      const dumpFilename = `window_dump_${crypto.randomUUID()}.xml`;
      const devicePath = `/sdcard/${dumpFilename}`;
      const tempPath = path.join(os.tmpdir(), dumpFilename);

      return withDeviceLock(async () => {
        try {
          let lastErr: any;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await runAdb(["shell", "uiautomator", "dump", devicePath]);
              lastErr = null;
              break;
            } catch (e) {
              lastErr = e;
              await new Promise((r) => setTimeout(r, 400));
            }
          }
          if (lastErr) throw lastErr;

          await runAdb(["pull", devicePath, tempPath]);
          const xmlData = await fs.readFile(tempPath, "utf8");

          const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
          });
          const jsonObj = parser.parse(xmlData);
          const tree = jsonObj.hierarchy ? xmlNodeToTree(jsonObj.hierarchy) : null;

          return {
            content: [{ type: "text", text: JSON.stringify(tree, null, 2) }],
          };
        } catch (e: any) {
          logs += `ADB fetch failed: ${e.message}\n`;
          return {
            content: [
              {
                type: "text",
                text:
                  `Failed to fetch screen nodes.\nMake sure you have enabled "LAN MCP service" in the App (if using IP) or connected via USB (if using ADB).\n\nLogs:\n${logs}`,
              },
            ],
            isError: true,
          };
        } finally {
          await runAdb(["shell", "rm", devicePath]).catch(() => {});
          await fs.unlink(tempPath).catch(() => {});
        }
      });
    }

    case "capture_screenshot": {
      const ip = getDeviceIp();
      let logs = "";

      if (ip) {
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
        }
      }

      logs += `\nFalling back to ADB screencap...\n`;
      try {
        const buffer = await captureScreencap();
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
        logs += `ADB screencap failed: ${e.message}\n`;
        return {
          content: [
            {
              type: "text",
              text:
                `Failed to capture screenshot.\nMake sure you have enabled "LAN MCP service" in the App (if using IP) or connected via USB (if using ADB).\n\nLogs:\n${logs}`,
            },
          ],
          isError: true,
        };
      }
    }

    case "list_skills": {
      const res = await deviceApiGet("/api/mcp/skills");
      if (!res.ok) {
        return toolNotImplemented("list_skills", res.logs);
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
        return {
          content: [{ type: "text", text: `delete_skill failed.\n${res.logs}${res.body}` }],
          isError: true,
        };
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
        return {
          content: [{ type: "text", text: `run_skill failed.\n${res.logs}${res.body}` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: res.body || `Started ${skillId}` }] };
    }

    case "stop_skill": {
      const { skillId } = (request.params.arguments as any) || {};
      const res = await deviceApiPost("/api/mcp/stop", skillId ? { skillId } : {});
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `stop_skill failed.\n${res.logs}${res.body}` }],
          isError: true,
        };
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
        return toolNotImplemented("get_skill_status", res.logs);
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
        return toolNotImplemented("get_execution_log", res.logs);
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
