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
- 配对码不进仓库。刚装完则直接 Session start，勿重复讲安装

## MCP capability gate

1. 会话目录缺工具但 CLI `tools/list` 已有 → **新开对话**
2. 缺 `pair_device` / `plans_*` → 升级 `autoace-cli@latest` 并重载 MCP
3. 有 `pair_device` → Session start；无则用其他工具静默配对并请补贴「复制给 Agent」全文
4. 无 `plans_*` → 不做计划，勿编造 schema

## Session start

1. 收集配对材料（全文最佳）
2. `pair_device` + `connectionInfo`（不臆造设备字段）
3. 展示配对结果与能力摘要
4. 同条已有任务则继续，否则等待
5. 无「设备：」行则请补贴

## Skills flow

看屏 → `get_kuaiyou_schema` → 按 [craft.md](craft.md) 起草 → `validate_kuaiyou_skill` → `push_reactive_skill`（手机确认）→ 点偏则 `run_skill` / `get_execution_log` / UI 对照后重推。

禁止：`agentId`、`readText`、`setClipboard`、`askAgent`。

## Plans flow

`plans_schema` → 起草 → `plans_validate` → `plans_deploy`（须手机确认）。404 / unavailable → 停。勿镜像仓库 schema。

## Hard rules

契约只认设备；敏感信息不进仓库；curl 兜底见 [reference.md](reference.md)。
