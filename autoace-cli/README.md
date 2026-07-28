# autoace-cli

**The Agentic Skills** - 快游大师电脑端 MCP CLI（npm 包名：`autoace-cli`）。让 Claude Code / Codex / Cursor 等连接 Android 上的「快游大师」App，编写并推送**智能体技能**。

配套 Agent Skill 名称：**`autoace`**（仓库路径 `agent-skills/autoace/`）。

- **npm**：https://www.npmjs.com/package/autoace-cli
- **源码**：https://github.com/kuaiyou-app/kuaiyou-open-source/tree/main/autoace-cli
- **官网文档**：https://kuaiyou-app.github.io/docs/
- **接入教程**：https://github.com/kuaiyou-app/kuaiyou-open-source/blob/main/docs/mcp-ecosystem-tutorial.md

兼容旧命令名：`kuaiyou-mcp-server`（同一二进制）。

> 旧 npm 包 `kuaiyou-mcp-server` 已废弃，不再更新。请改用 `autoace-cli`；`kuaiyou-mcp-server` 命令本身仍随本包安装，无需改动现有 MCP 配置。

## 要求

- Node.js ≥ 18、npm ≥ 9
- 手机已安装快游大师，并开启 **MCP 服务**
- 局域网模式：手机与电脑同一 Wi‑Fi；点击「MCP 服务」可复制给 Agent 的完整连接配置

## 安装 / 配置

`autoace-cli` 是 stdio MCP server。请在 Cursor / Claude / Codex 等客户端中注册，而不是只在普通终端前台运行：

```text
serverName: autoace
transport: stdio
command: npx
args: ["-y", "autoace-cli"]
env:
  KUAIYOU_DEVICE_IP: "192.168.1.100:41899"
  KUAIYOU_MCP_PAIRING_CODE: "482917"
```

端口与配对码每次开启 MCP 服务都会变化，请使用 App 当前复制的值；配对码不要写入项目仓库、日志或 Git 提交。连续错码返回 `429` 时，按 `Retry-After` 等待后再试。

也可全局安装：`npm install -g autoace-cli`，客户端 command 使用 `autoace-cli`。

## License

Apache-2.0
