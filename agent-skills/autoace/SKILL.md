---
name: autoace
description: >-
  用 autoace-cli（MCP）连接快游大师：看屏（observe_screen）、编写校验推送 Android 自动化技能 JSON、
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
- MCP 名 `autoace`；env 可选 `KUAIYOU_DEVICE_IP`（含端口）与 `KUAIYOU_MCP_PAIRING_CODE`。`pair_device` 成功后写入本机 `~/.config/autoace/device.json`，冷启动不必改 mcp.json。同网；无 USB 自动发现
- Skill：`npx -y skills add kuaiyou-app/kuaiyou-open-source --skill autoace -g -y`
- 配对码不进仓库

### Install acceptance（装完必做）

1. 确认客户端 MCP 目录里出现 `autoace` 工具（仅证明配置被读到）。
2. **用当前 env 打一次** `pair_device`（或无工具时用 [reference.md](reference.md) curl `POST /api/mcp/pair`）。
3. 成功 → 进入 Session start；失败 → 明确告诉用户「配置未生效，请按下方 Cursor 重载步骤重载 MCP」，**禁止**宣称「已装好/已连上」。

刚装完且验收通过则直接 Session start，勿重复讲安装。

## MCP capability gate

1. 会话目录缺工具但 CLI `tools/list` 已有 → **新开对话**
2. 缺 `pair_device` / `get_kuaiyou_prompts` / `plans_*` → 升级 `autoace-cli@latest` 并按下方重载 MCP
3. 有 `pair_device` → Session start；无则用其他工具静默配对并请补贴「复制给 Agent」全文
4. 无 `get_kuaiyou_prompts` → 不做技能/计划生成（可仍看屏、跑已有技能）；勿用仓库 / craft.md 当权威提示词
5. 无 `plans_*` → 不做计划，勿编造 schema
6. 无 `observe_screen` → 用 `capture_screenshot` + `get_ui_tree`；有则不要默认拉完整树

### 目录有工具 ≠ 通道可用

Cursor MCP 面板显示 ready / 工具列表可见，**不等于** stdio 通道可用，也**不等于**手机地址仍有效。

- 工具返回「设备已断开或地址已失效」/ 超时 / 连不上 → **先认断开**，请用户重新配对（见 Session start），不要空转截屏/schema。
- 若工具调用报 `Not connected`、或进程已死但 UI 仍 ready → 按「Cursor 如何真正重载 autoace」处理（stdio 死通道，不是地址配置）。

### Cursor 如何真正重载 autoace

改 `mcp.json`、升级 CLI、或杀了旧进程后仍连不上时（stdio 死通道；换地址请用 `pair_device`，不必为换地址而重载）：

1. Cursor Settings → MCP：对 `autoace` **Disable → Enable**（或删除后按原配置重新添加）
2. 仍不行 → **完全退出并重启 Cursor**（不是只关窗口）
3. 重载后 **新开一条 Agent 对话**（旧对话可能缓存死通道）
4. 再跑 Install acceptance 的 pair；成功后再继续业务

仅杀 Node/MCP 子进程通常不够；目录仍可能显示 ready。

## Session start

1. 收集配对材料（全文最佳；也可结构化 `host`/`port`/`code`/`deviceLabel`）
2. 尝试 `pair_device`，传入 `connectionInfo`（及可选结构化字段）。CLI 会用材料中的地址/配对码覆盖本进程目标，并写入本机配置（默认 `~/.config/autoace/device.json`）。**不必**为了换地址去改 mcp.json 或重载 MCP。
3. 工具返回「设备已断开或地址已失效」、超时或连不上 → **先认断开**：请用户到 App 设置 → MCP 服务 重新复制「复制给 Agent」，再调用 `pair_device`（`connectionInfo` 全文）。成功即覆盖本机保存的目标。**不要**用旧 IP 继续截屏/schema，也不要把 curl 打旧地址当成已恢复。
4. HTTP `401` / `429` → 配对码错或限流，复制**当前**码；不要说成设备掉线。HTTP `404`（health 通但业务路由无）→ 升级 App，不是断开。
5. 若工具调用报 `Not connected`、或进程已死但 UI 仍 ready → 走上方 Cursor 重载步骤（stdio 死通道）。换地址本身不需要这一层。
6. 无论 MCP 或 curl：向用户展示配对摘要（地址、设备画像、可用能力）；无「设备：」行则请补贴。curl 仅在无 MCP 进程时作兜底，且必须打**当前** App 地址。
7. 同条已有任务则继续，否则等待。

## Skills flow

1. `get_kuaiyou_prompts` + `get_kuaiyou_schema`。缺 prompts（404）→ **停**，请用户升级 App；禁止用本仓库 / craft.md 当权威提示词。
2. 用返回的 `skill.template` 填 `{{userRequirement}}` 作为生成规则。执行 `skill.agentMust`（先契约、能看屏则看屏、产出完整技能 JSON、validate 再 push）。**不要**执行 `clipboardMust`（那是手机剪贴板外壳）。**忽略未知字段**；禁止把 prompts 正文写入仓库或当缓存。
3. 看屏优先 `observe_screen`；无此工具则 `capture_screenshot` + `get_ui_tree`。不要默认拉取完整 UI 树。
4. `validate_kuaiyou_skill` → `push_reactive_skill`（`skillJson` 可以是 JSON 字符串或 `.json` 文件路径，与 validate 相同；须手机确认。`run: true` 时 CLI 会等你确认后启动并等到结束/失败，返回 log 摘要；失败带截屏。CLI **不能**跳过 App 确认框。）
5. 点偏：看上一步返回的 log / 截屏，或 `run_skill`（`wait: true`）/ `get_execution_log` / 再 `observe_screen` 对照后改 JSON 再推。

禁止：`agentId`、`readText`、`setClipboard`、`askAgent`。

## Plans flow

1. `get_kuaiyou_prompts` + `plans_schema`。缺任一 → 停。忽略 prompts 未知字段；禁止把返回文案提交进 git。
2. 按用户场景取 `planOutlines[]`（默认 `study`）。用 `template` 填 `{{goal}}` `{{background}}` `{{durationDays}}` `{{dailyMinutes}}`；仅当用户明确要求增强时用 `enhancedTemplate`。
3. 按该条 `hydrate` 组装**完整** `LearningPlan`（新 UUID、`SAVE_ONLY`、场景 `defaultMasteryRule`、每个 `node.phaseId` = 父 phase.id、`leaveEmpty` 所列字段不生成、`generatedBy` = 当前对话模型名）。
4. `generatedBy` 禁止写 `autoace-cli` / `mcp` / Skill 名。
5. `plans_validate` → `plans_list` 查配额（新 id 满槽先问用户）→ 同 id 覆盖须明示会清进度 → `plans_deploy`（须手机确认）。

## Project path plans (P3)

用户给出本机目录并要求生成学习计划/大纲并导入时：

1. 路径必须是已存在的目录；未给路径则先问，不猜家目录。
2. 默认 `study`。用户明确考证/面试才用 `exam_cert` / `interview`。代码仓禁止套 `fitness` / `habit` / `reading`。
3. 抽样：最多 8 个文件、合计约 80KB、单文件前 200 行。优先 README*、package.json / go.mod / pyproject.toml / Cargo.toml / build.gradle*、两层目录。跳过 `.git`、`node_modules`、`build`、`dist`、`.gradle`、`.env`、密钥。
4. **禁止**把源码经 MCP POST 到设备。
5. 用 3～5 行复述项目后，读取 `prompts.projectPath`：把 `askUser` **原文**给用户（本轮已选技术/产品/业务切面则跳过）。不要另写长规则。
6. 按所选切面填 `goal` / `background` / 节点：只写**可迁移**知识要点，不是该项目的私有业务。遵守 `privacyMust`（密钥、客户数据、文案/量表原文、内部 SOP 不进计划；源码不经 MCP POST）。
7. 周期：用户有说就用；否则 README+包清单且目录浅 → 14 天 / 30 分钟；多模块或测试/文档较全 → 21 天 / 45 分钟；夹在 3–30，生成前展示推断值。
8. 只到大纲。用户要节点正文 → 请回 App 打开节点生成，本轮不推正文。
9. 其后走上方 Plans flow 的 validate / 配额 / deploy。

## Hard rules

契约只认设备；敏感信息不进仓库；curl 兜底见 [reference.md](reference.md)。
