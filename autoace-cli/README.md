# autoace-cli

**The Agentic Skills** - 快游大师电脑端 MCP CLI（npm 包名：`autoace-cli`）。让 Claude Code / Codex / Cursor 等连接 Android 上的「快游大师」App，编写并推送**智能体技能**与**领域教练学习计划**。

配套 Agent Skill：`npx -y skills add kuaiyou-app/kuaiyou-open-source --skill autoace -g -y`。CLI：`npm install -g autoace-cli@latest`。

- **npm**：https://www.npmjs.com/package/autoace-cli
- **源码**：https://github.com/kuaiyou-app/kuaiyou-open-source/tree/main/autoace-cli
- **官网文档**：https://kuaiyou-app.github.io/docs/
- **接入教程**：https://github.com/kuaiyou-app/kuaiyou-open-source/blob/main/docs/mcp-ecosystem-tutorial.md

兼容旧命令名：`kuaiyou-mcp-server`（同一二进制）。

> 旧 npm 包 `kuaiyou-mcp-server` 已废弃，不再更新。请改用 `autoace-cli`；`kuaiyou-mcp-server` 命令本身仍随本包安装，无需改动现有 MCP 配置。

## 要求

- Node.js ≥ 20、npm ≥ 10
- 手机已安装快游大师，并开启 **MCP 服务**
- 局域网模式：手机与电脑同一 Wi‑Fi；点击「MCP 服务」可复制给 Agent 的完整连接配置

## 安装 / 配置

```bash
npm install -g autoace-cli@latest
```

`autoace-cli` 是 stdio MCP server。请在 AI 客户端中注册，而不是只在普通终端前台运行：

```text
serverName: autoace
transport: stdio
command: autoace-cli
args: []
env:
  KUAIYOU_DEVICE_IP: "192.168.1.100:41899"
  KUAIYOU_MCP_PAIRING_CODE: "482917"
```

也可用 `command: npx` + `args: ["-y","autoace-cli@latest"]`。按客户端配置格式改写即可。

如果客户端提供 TLS 地址，可改用优先级更高的 `KUAIYOU_DEVICE_URL=https://host:port`。当前仅提供 IP 的客户端仍通过兼容的局域网 HTTP 通道连接；此时应使用可信、隔离的网络，因为配对码和屏幕数据不会获得传输层加密保护。

端口与配对码每次开启 MCP 服务都会变化，请使用 App 当前复制的值；配对码不要写入项目仓库、日志或 Git 提交。连续错码返回 `429` 时，按 `Retry-After` 等待后再试。

## 契约获取

CLI **不内置**技能或学习计划 Schema。

- 技能：`get_kuaiyou_schema` → `GET /api/mcp/schema`；`validate_kuaiyou_skill` / `push_reactive_skill` 运行时拉取同一端点。
- 生成规则：`get_kuaiyou_prompts` → `GET /api/mcp/prompts`（设备权威；勿缓存/写入仓库；404 请升级 App，禁止用仓内 markdown 兜底）。
- 领域教练计划：`plans_schema` → `GET /api/mcp/plans/schema`；`plans_validate` / `plans_deploy` 运行时拉取该端点。**禁止**把 `learning-plan.schema.json` 镜像进本仓当权威。

客户端是唯一契约源；未连接设备时不能执行完整契约校验。计划路由需 App 版本支持（与 `feat/mcp-plan-import` 联调）；若设备返回 404，工具会提示当前 App 尚未暴露该路由。

### 配对与会话开场

`pair_device` 成功后会综合展示：

1. **配对成功**（`POST /api/mcp/pair`）
2. **用户提供的连接/配对材料**（`connectionInfo`：App 复制文案中的地址与 `设备：品牌 · Android · 分辨率 · App` 等；也可传结构化 `host`/`port`/`code`/`deviceLabel`）——设备画像来自用户材料，**不**由 CLI 假定 pair 响应体结构
3. **CLI 能力摘要**

传入的地址/配对码会**临时覆盖**本 MCP 进程的 `KUAIYOU_DEVICE_IP` / `KUAIYOU_MCP_PAIRING_CODE`（无需先重启 MCP）；请同步更新 `mcp.json` env（`KUAIYOU_DEVICE_IP` 为 `host:port`，不要带 `http://`），否则下次冷启动仍回旧值。

设备工具在请求前会探活 `GET /api/mcp/health`（免鉴权）。超时、连接拒绝或网络失败会**立刻停止**，提示设备已断开、需要重新配对，并清掉进程内的旧地址覆盖与 pair 缓存——不会继续对失效 IP 截屏/拉 schema。HTTP `401`/`429` 是配对码或限流，不是掉线；业务路由 `404` 是 App 过旧，请升级。

配套 Agent Skill（`autoace`）要求：配对后先展示该综合上下文；若用户同条消息已给出编写任务则立即继续，否则等待指示。写技能前优先调用 `observe_screen`（截屏 + 可交互节点），不要一上来拉取完整 `get_ui_tree`。

### 计划 MCP tools（与设备 §3 对齐）

| Tool | 设备路由 |
|------|----------|
| `plans_schema` | `GET /api/mcp/plans/schema` |
| `plans_list` | `GET /api/mcp/plans` |
| `plans_get` | `GET /api/mcp/plans/{id}` |
| `plans_validate` | schema + `POST /api/mcp/plans/validate` |
| `plans_deploy` | `POST /api/mcp/plans`（`pendingConfirm=true`，须手机确认） |
| `plans_delete` | `POST /api/mcp/plans/delete` `{ "planId" }` |

部署成功仅表示进入确认流；同 id 覆盖含进度；新 id 无保有槽返回 HTTP 409。

也可全局安装：`npm install -g autoace-cli`，客户端 command 使用 `autoace-cli`。

## License

Apache-2.0
