---
name: autoace
description: >-
  用 autoace-cli（MCP）连接快游大师：截屏/UI 树、编写校验推送 Android 自动化技能 JSON、
  以及领域教练 LearningPlan。在用户提到快游、MCP 配对、技能推送、领域教练/学习计划，
  或要操作手机屏幕时使用。
---

# autoace

用 **autoace-cli**（MCP）为快游大师编写并推送**技能**（手机端自动化 JSON）与**领域教练学习计划**（`LearningPlan`）。

本 Skill **不是安装器**。首次安装 CLI / MCP / 本 Skill 请让用户按网站指南或执行 `npx skills add`（见下）。详细工具表与错误码见 [reference.md](reference.md)；编写质量见 [craft.md](craft.md)。

## Names (do not confuse)

| Name | What it is |
| --- | --- |
| **autoace-cli** | 电脑端 npm / MCP CLI |
| **autoace** | 本 Agent Skill（给 Agent 的流程说明） |
| **技能 (skill)** | 手机内执行的自动化 JSON — 不是本文件 |
| **学习计划 (plan)** | 领域教练 `LearningPlan` JSON；手机确认后出现在领域教练 |

对用户只说**技能** / **计划**。不要发明 ReactiveSkill 等产品名。工具名 `push_reactive_skill` 仅内部使用，对用户说「推送技能」。

## Prerequisites (human setup)

- 手机：设置 → 高级 → **MCP 服务** 开启；点服务行复制完整连接信息。
- 电脑：Node.js ≥ 20、npm ≥ 10。
- MCP 名建议 `autoace`；command 用 `npx`，args 建议钉版本，如 `["-y","autoace-cli@1.0.8"]`。
- 必填 env：`KUAIYOU_DEVICE_IP`（含端口）与 `KUAIYOU_MCP_PAIRING_CODE`。同网局域网 HTTP；**不要假设 USB 可免 env / 自动发现**。
- 配对码/端口每次开启 MCP 会变；错码会 `429`。配对码永不写入仓库/日志/提交。
- 推荐安装本 Skill 整包（含 `reference.md` / `craft.md`）：

```bash
npx -y skills add kuaiyou-app/kuaiyou-open-source --skill autoace -g -y
```

若用户刚按安装指南装完：展示 MCP 可用后直接走 **Session start**，不要再重复讲一遍 npm。

## MCP capability gate (required)

动手前确认当前会话的 MCP 工具目录 / `tools/list`：

1. **客户端目录缺工具，但 CLI 直连 `tools/list` 已有**：多为会话缓存 → **新开 Agent 对话**（必要时重启 MCP），勿在旧长会话里空转。
2. **缺 `pair_device` / `plans_*`**：提示升级/重装 `autoace-cli`（清 npx 缓存或钉最新版）并重载 MCP；修复前用已有工具降级。
3. **有 `pair_device`**：走 Session start。
4. **无 `pair_device`**：用 `get_kuaiyou_schema` 等触发静默配对；说明设备画像可能不全，请补贴 App「复制给 Agent」全文。
5. **无 `plans_*`**：不要编造计划 schema；仅做技能流程，或等 CLI/App 升级。

## Session start

写/部署任何技能或计划前：

1. 收集用户配对材料（App「复制给 Agent」全文最佳；至少地址/配对码；通常含 `设备：品牌 · Android … · 宽x高 · App …`）。
2. 若有 `pair_device`：把原文传入 `connectionInfo`（不臆造设备字段；不假设 pair HTTP 体含 device JSON）。
3. 向用户展示：配对结果 + 设备画像/地址 + CLI 能力摘要。
4. **若同条消息已有编写任务 → 展示后立即执行；否则等待指示。**
5. 材料无「设备：」行时如实说明并请补贴。

## Skills flow

1. 需要看屏时：`capture_screenshot` 和/或 `get_ui_tree`。
2. `get_kuaiyou_schema` — 唯一权威契约（`GET /api/mcp/schema`）。禁止用仓库本地 schema 副本。
3. 按契约 + [craft.md](craft.md) 起草技能 JSON。
4. `validate_kuaiyou_skill` → 修到通过。
5. `push_reactive_skill` → 等用户在手机确认导入/运行。
6. **调试闭环**（点偏或行为不对时强制走）：`list_skills`（可选）→ `run_skill` → `get_skill_status` / `get_execution_log` → 对照 UI 改 JSON → 再 validate → push。可用 `stop_skill` / `delete_skill` 收尾。

禁止字段/动作：`agentId`、`readText`、`setClipboard`、`askAgent`。

## Plans flow（领域教练）

需 App 暴露 `/api/mcp/plans*`。工具返回「not available」或 `404` → 停，说明当前 App 未支持，**不要**镜像 `learning-plan.schema.json`。

1. `plans_schema` → 按返回契约起草 `LearningPlan`。
2. `plans_validate` → 修到通过。
3. `plans_deploy` → `pendingConfirm=true`，须手机确认。同 id 覆盖大纲与进度；新 id 可能 `409`（配额满）。
4. 可选：`plans_list` / `plans_get` / `plans_delete`。

## Hard rules

- 契约只认设备运行时 schema；仓库 `examples/`、`skills/` 仅思路参考。
- 配对码、截图、UI 文本敏感信息：不提交仓库、不写入可分享日志。
- MCP 不可用时的 curl 兜底见 [reference.md](reference.md)。
