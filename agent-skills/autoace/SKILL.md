---
name: autoace
description: Build and sync Kuaiyou Master Android automation skills with autoace-cli (MCP). Use when the user wants to inspect the phone screen, write/validate a skill JSON, or push a skill to the device.
---

# autoace

Help the user create **skills** (Android automation JSON) for the Kuaiyou Master app, using **autoace-cli** over MCP when available.

## Names (do not confuse)

| Name | What it is |
| --- | --- |
| **autoace-cli** | npm / MCP CLI on the computer |
| **autoace** | This Agent Skill (workflow instructions for Claude Code / Codex / Cursor) |
| **技能 (skill)** | JSON executed on the phone inside Kuaiyou Master — not this file |

Prefer saying **技能** / **skill** to the user. Do not invent product names like ReactiveSkill for end users.

## Prerequisites

1. Phone: Kuaiyou Master → Settings → Advanced → **MCP 服务** on. The pairing code is masked by default; click the service row to copy the complete stdio configuration.
2. Computer: Node.js ≥ 20 and npm ≥ 10; register an MCP server named `autoace` with `command=npx`, `args=["-y","autoace-cli"]`, and the copied:
   - `KUAIYOU_DEVICE_IP`
   - `KUAIYOU_MCP_PAIRING_CODE`
   Prefer user/local MCP configuration. Never write the pairing code into the repository, logs, docs, or Git commits.
3. Phone and computer must be on the same network — the LAN HTTP channel is the only transport.
4. The port and pairing code are regenerated every time the MCP service is switched on, so
   `KUAIYOU_DEVICE_IP` must include the port and both values need re-entering after a restart.
   Repeated wrong pairing codes make the device back off with `429` + `Retry-After`.

## Preferred flow (MCP)

1. `capture_screenshot` and/or `get_ui_tree` to understand the current screen.
2. Call `get_kuaiyou_schema` to read the authoritative contract from the running client's `GET /api/mcp/schema`, then draft a matching skill JSON. Do not rely on a repository-local schema copy.
3. `validate_kuaiyou_skill` — the CLI fetches the same client contract again; fix until valid.
4. `push_reactive_skill` — wait for the user to confirm import/run on the phone.
5. Iterate with natural language if the tap misses.

Do **not** use removed fields/actions: `agentId`, `readText`, `setClipboard`, `askAgent`.

## Fallback sync (no MCP push)

If MCP push is unavailable, save the skill JSON and post it over the LAN yourself.
Fetch the current contract first; never infer it from repository examples. The pairing code is required — without the `Authorization` header the device answers `401`.

```bash
curl "http://<DEVICE_IP>:<PORT>/api/mcp/schema" \
  -H "Authorization: Bearer <PAIRING_CODE>"
```

Validate the generated JSON against that response before importing it.

```bash
curl -X POST "http://<DEVICE_IP>:<PORT>/api/mcp/import" \
  -H "Authorization: Bearer <PAIRING_CODE>" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/generated_skill.json
```

A successful response looks like `{"status":"ok","skillId":"…","pendingConfirm":true}`;
the phone then shows an import confirmation dialog.

## How users invoke this Agent Skill

- **Claude Code**: `/autoace` or rely on description match
- **Codex**: `$autoace` or `/skills`
- **Cursor**: skill auto-loads when relevant if installed under project/user skills
