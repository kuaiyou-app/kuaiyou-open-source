---
name: autoace
description: >-
  用 autoace-cli（MCP）连接快游大师：截屏/UI 树、编写校验推送 Android 自动化技能 JSON、
  以及领域教练 LearningPlan。在用户提到快游、MCP 配对、技能推送、领域教练/学习计划，
  或要操作手机屏幕时使用。
---

# autoace

用 **autoace-cli**（MCP）为快游大师编写并推送**技能**与**领域教练学习计划**（`LearningPlan`）。

本 Skill 不是安装器。未安装时请用户按 https://kuaiyou-app.github.io/autoace-cli-installation-guide.md 或执行下方命令。细节见 [reference.md](reference.md)、[craft.md](craft.md)。

## Names

| Name | What it is |
| --- | --- |
| **autoace-cli** | 电脑端 MCP CLI |
| **autoace** | 本 Agent Skill |
| **技能** | 手机内自动化 JSON |
| **计划** | 领域教练 `LearningPlan` |

对用户说**技能** / **计划**。工具名 `push_reactive_skill` 仅内部用。

## Prerequisites

- 手机开启 MCP 服务并复制连接信息
- Node ≥ 20：`npm install -g autoace-cli@latest`
- MCP 名 `autoace`；env 必填 `KUAIYOU_DEVICE_IP`（含端口）与 `KUAIYOU_MCP_PAIRING_CODE`；同网；无 USB 自动发现
- Skill：`npx -y skills add kuaiyou-app/kuaiyou-open-source --skill autoace -g -y`
- 配对码不进仓库

### Install acceptance（装完必做）

1. 确认客户端 MCP 目录里出现 `autoace` 工具（仅证明配置被读到）。
2. **用当前 env 打一次** `pair_device`（或无工具时用 [reference.md](reference.md) curl `POST /api/mcp/pair`）。
3. 成功 → 进入 Session start；失败 → 明确告诉用户「配置未生效，请按下方 Cursor 重载步骤重载 MCP」，**禁止**宣称「已装好/已连上」。

刚装完且验收通过则直接 Session start，勿重复讲安装。

## MCP capability gate

1. 会话目录缺工具但 CLI `tools/list` 已有 → **新开对话**
2. 缺 `pair_device` / `plans_*` → 升级 `autoace-cli@latest` 并按下方重载 MCP
3. 有 `pair_device` → Session start；无则用其他工具静默配对并请补贴「复制给 Agent」全文
4. 无 `plans_*` → 不做计划，勿编造 schema

### 目录有工具 ≠ 通道可用

Cursor MCP 面板显示 ready / 工具列表可见，**不等于** stdio 通道可用。若工具调用报 `Not connected`、超时、或进程已死但 UI 仍 ready → 按「Cursor 如何真正重载 autoace」处理，不要空转 `pair_device`。

### Cursor 如何真正重载 autoace

改 `mcp.json` env、升级 CLI、或杀了旧进程后仍连不上时：

1. Cursor Settings → MCP：对 `autoace` **Disable → Enable**（或删除后按原配置重新添加）
2. 仍不行 → **完全退出并重启 Cursor**（不是只关窗口）
3. 重载后 **新开一条 Agent 对话**（旧对话可能缓存死通道）
4. 再跑 Install acceptance 的 pair；成功后再继续业务

仅杀 Node/MCP 子进程通常不够；目录仍可能显示 ready。

## Session start

1. 收集配对材料（全文最佳；也可结构化 `host`/`port`/`code`/`deviceLabel`）
2. 尝试 `pair_device`，传入 `connectionInfo`（及可选结构化字段）。CLI 会把材料中的地址/配对码**临时覆盖**本进程 env，无需先重启 MCP；仍请用户同步改 `mcp.json`，否则下次冷启动回到旧值。
3. 若 MCP 报 `Not connected` / 工具调用失败 → **立即**走 curl 兜底（见 [reference.md](reference.md)）：`POST /api/mcp/pair`，需要时再 `schema`/`import` 或 `plans/schema`/`plans`。**不要干等重连。**
4. 无论 MCP 或 curl：向用户展示配对摘要（地址、设备画像、可用能力）；无「设备：」行则请补贴。
5. 同条已有任务则继续，否则等待。

## Skills flow

看屏 → `get_kuaiyou_schema` → 按 [craft.md](craft.md) 起草 → `validate_kuaiyou_skill` → `push_reactive_skill`（手机确认）→ 点偏则 `run_skill` / `get_execution_log` / UI 对照后重推。

禁止：`agentId`、`readText`、`setClipboard`、`askAgent`。

双推技能时：手机通常一次只弹一个确认框，第二份可能排队。当前无 pending/queue 查询 API 时，以手机确认框为准；勿仅靠截屏臆测队列位置。

## Plans flow

1. `plans_schema` → 起草（**字段以设备 schema 为准**，勿镜像仓库示例）
2. `generatedBy` 必须填**当前对话所用模型名**（如 `Cursor Grok 4.5`）。禁止写 `autoace-cli`、`mcp`、通道名或 Skill 名。
3. `plans_validate`
4. `plans_list` 查配额：若已满且新 id → 先问用户删旧计划 / 改用已有 id 覆盖 / 手动腾位；**勿**直接 `plans_deploy` 撞 409。
5. 若目标 id 已存在 → **强提醒**：同 id 会整份覆盖大纲**与**进度，征得用户确认后再部署。
6. `plans_deploy`（须手机确认）。404 / unavailable → 停。勿镜像仓库 schema。

## Hard rules

契约只认设备；敏感信息不进仓库；curl 兜底见 [reference.md](reference.md)。
