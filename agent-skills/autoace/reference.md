# autoace reference

配套主文件：[SKILL.md](SKILL.md)。Agent 仅在需要错误处理、完整工具表或无 MCP curl 时读取本文。

## Full MCP tool surface

与 `autoace-cli` `tools/list` / `formatCliCapabilities()` 对齐。缺工具 → 升级 CLI 并按 [SKILL.md](SKILL.md)「Cursor 如何真正重载 autoace」重载。

### Session / contract

| Tool | 作用 |
| --- | --- |
| `pair_device` | `POST /api/mcp/pair`；用 `connectionInfo` 或结构化 `host`/`port`/`code`/`deviceLabel` 合成设备画像 + 能力摘要；覆盖本进程目标并写入本机 `device.json` |
| `get_kuaiyou_schema` | `GET /api/mcp/schema`（技能权威契约） |
| `get_kuaiyou_prompts` | `GET /api/mcp/prompts`（技能/计划生成规则；需 App 支持） |
| `plans_schema` | `GET /api/mcp/plans/schema`（计划权威契约；需 App 支持） |

### Screen

| Tool | 作用 |
| --- | --- |
| `observe_screen` | **优先**：截屏 + 可交互节点摘要（text/id/bounds/centerPct）+ 当前包名 |
| `capture_screenshot` | 仅当前屏幕截图 |
| `get_ui_tree` | 完整 UI 节点树（体积大，可能含敏感文案；摘要不够时再用） |

### Skills lifecycle

| Tool | 作用 |
| --- | --- |
| `validate_kuaiyou_skill` | 拉契约 + 校验 + 业务 lint |
| `push_reactive_skill` | 校验后部署；`skillJson` 与 validate 一样可以是 JSON 或 `.json` 路径；成功多为 `pendingConfirm`，须手机确认 |
| `list_skills` | 列出设备上已装技能 |
| `delete_skill` | 按 id 删除 |
| `run_skill` | 开始执行 |
| `stop_skill` | 停止当前执行 |
| `get_skill_status` | 执行状态 |
| `get_execution_log` | 最近执行日志 |

### Plans lifecycle

| Tool | 设备路由 |
| --- | --- |
| `plans_list` | `GET /api/mcp/plans` |
| `plans_get` | `GET /api/mcp/plans/{id}` |
| `plans_validate` | schema + `POST /api/mcp/plans/validate`（不持久化） |
| `plans_deploy` | `POST /api/mcp/plans`（`pendingConfirm=true`） |
| `plans_delete` | `POST /api/mcp/plans/delete` `{ "planId" }`（无确认框，慎用） |

## Error decision tree

| 现象 | 处理 |
| --- | --- |
| 设备已断开 / 地址已失效 / 超时 / 连不上 | **先认断开**：请用户到 App 重新复制「复制给 Agent」，`pair_device`（connectionInfo 全文）。成功会覆盖本机保存的地址，无需改 mcp.json。不要用旧 IP 继续截屏/schema |
| `Not connected` / 工具调用失败但目录仍 ready | 第二层：mcp.json 冷启动仍是旧值或 stdio 死通道；按 [SKILL.md](SKILL.md) Cursor 重载步骤；curl 仅打**当前** App 地址 |
| `401` | 配对码错误或过期；让用户复制当前码；`pair_device`+`connectionInfo` 可临时覆盖。**不是**设备掉线 |
| `429` + `Retry-After` | 错码退避；等待指定秒数后再试，勿连打。**不是**设备掉线 |
| prompts / plans `404`（health 通但业务路由无） | 当前 App 未暴露该路由；请升级 App，停止该分支，勿用仓库 schema / craft.md 顶替。**不是**断开 |
| plans `409` | 配额满；应先 `plans_list`；删除或覆盖已有 id 后再 deploy |
| `pair_device` / `get_kuaiyou_prompts` 不在 tools/list | CLI 过旧或缓存；`npx -y autoace-cli@<latest>` / 清缓存后重载 |
| validate 失败 | 按返回错误改 JSON；以设备 schema 为准，勿猜字段 |
| 推送成功但手机无技能 | 提醒用户点确认对话框；成功仅表示进入确认流；双推时第二份可能排队 |

## Fallback sync (no MCP process)

仅当本机**没有**可用 MCP 进程时用 curl。若 CLI 已回报断开，先按上表重新配对，**不要**用旧 `KUAIYOU_DEVICE_IP` 再 curl。必须带 `Authorization: Bearer <PAIRING_CODE>`，且 `<DEVICE_IP>:<PORT>` 必须是 App **当前**地址。

配对后仍按 [SKILL.md](SKILL.md) 向用户输出配对摘要（地址、设备画像、当前能做的事）。

```bash
curl -X POST "http://<DEVICE_IP>:<PORT>/api/mcp/pair" \
  -H "Authorization: Bearer <PAIRING_CODE>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

```bash
curl "http://<DEVICE_IP>:<PORT>/api/mcp/schema" \
  -H "Authorization: Bearer <PAIRING_CODE>"
```

```bash
curl "http://<DEVICE_IP>:<PORT>/api/mcp/prompts" \
  -H "Authorization: Bearer <PAIRING_CODE>"
```

按返回契约校验本地 JSON 后再导入：

```bash
curl -X POST "http://<DEVICE_IP>:<PORT>/api/mcp/import" \
  -H "Authorization: Bearer <PAIRING_CODE>" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/generated_skill.json
```

成功形如 `{"status":"ok","skillId":"…","pendingConfirm":true}`。

计划（路由存在时）：

```bash
curl "http://<DEVICE_IP>:<PORT>/api/mcp/plans/schema" \
  -H "Authorization: Bearer <PAIRING_CODE>"

curl "http://<DEVICE_IP>:<PORT>/api/mcp/plans" \
  -H "Authorization: Bearer <PAIRING_CODE>"

curl -X POST "http://<DEVICE_IP>:<PORT>/api/mcp/plans" \
  -H "Authorization: Bearer <PAIRING_CODE>" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/learning_plan.json
```

## Security

- 配对码：仅用户/本地 MCP env；禁止写入仓库、文档、PR、日志、commit。
- 截图与 UI 树可能含账号/聊天等隐私：只在可信环境处理。
- 当前局域网 HTTP 通道无传输层加密；仅在可信隔离网络使用。

## Sync this Skill

权威目录：`agent-skills/autoace/`（默认分支 `develop`）。

```bash
npx -y skills add kuaiyou-app/kuaiyou-open-source --skill autoace -g -y
```

`skills add -g` 可能尝试同步多个客户端（Cursor / Claude / PromptScript 等）。**以你正在使用的目标客户端为准**；其它客户端（如 PromptScript）失败可忽略，不影响主路径。

仓库内：`node scripts/sync-autoace-skill.mjs`（可选 `--cursor-user`）。Pages：`https://kuaiyou-app.github.io/agent-skills/autoace/`（须整包，勿只拉单个文件）。
