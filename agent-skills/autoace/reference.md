# autoace reference

配套主文件：[SKILL.md](SKILL.md)。Agent 仅在需要错误处理、完整工具表或无 MCP curl 时读取本文。

## Full MCP tool surface

与 `autoace-cli` `tools/list` / `formatCliCapabilities()` 对齐。缺工具 → 升级 CLI 并重载 MCP。

### Session / contract

| Tool | 作用 |
| --- | --- |
| `pair_device` | `POST /api/mcp/pair`；用 `connectionInfo` 合成设备画像 + 能力摘要 |
| `get_kuaiyou_schema` | `GET /api/mcp/schema`（技能权威契约） |
| `plans_schema` | `GET /api/mcp/plans/schema`（计划权威契约；需 App 支持） |

### Screen

| Tool | 作用 |
| --- | --- |
| `capture_screenshot` | 当前屏幕截图 |
| `get_ui_tree` | 当前 UI 节点树 |

### Skills lifecycle

| Tool | 作用 |
| --- | --- |
| `validate_kuaiyou_skill` | 拉契约 + 校验 + 业务 lint |
| `push_reactive_skill` | 校验后部署；成功多为 `pendingConfirm`，须手机确认 |
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
| `401` | 配对码错误或过期；让用户重新开启 MCP 服务并复制配置，更新 env 后重载 MCP |
| `429` + `Retry-After` | 错码退避；等待指定秒数后再试，勿连打 |
| 连不上 / 超时 | 确认同网、`KUAIYOU_DEVICE_IP` 含端口、手机 MCP 仍开 |
| plans / 部分路由 `404` 或 “not available yet” | 当前 App 未暴露该路由；停止该分支，勿用仓库 schema 顶替 |
| plans `409` | 配额满；`plans_list` 后删除或覆盖已有 id |
| `pair_device` 不在 tools/list | CLI 过旧或缓存；`npx -y autoace-cli@<latest>` / 清缓存后重载 |
| validate 失败 | 按返回错误改 JSON；以设备 schema 为准，勿猜字段 |
| 推送成功但手机无技能 | 提醒用户点确认对话框；成功仅表示进入确认流 |

## Fallback sync (no MCP push)

先拉契约再 POST。必须带 `Authorization: Bearer <PAIRING_CODE>`。

```bash
curl "http://<DEVICE_IP>:<PORT>/api/mcp/schema" \
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

仓库内：`node scripts/sync-autoace-skill.mjs`（可选 `--cursor-user`）。Pages：`https://kuaiyou-app.github.io/agent-skills/autoace/`（须整包，勿只拉单个文件）。
