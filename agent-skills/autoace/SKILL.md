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

1. Phone: Kuaiyou Master → Settings → Advanced → **MCP 服务** on; note `IP:port` + pairing code.
2. Computer: Node.js ≥ 18; MCP client configured to run `npx -y autoace-cli` with:
   - `KUAIYOU_DEVICE_IP`
   - `KUAIYOU_MCP_PAIRING_CODE`
3. Fallback without LAN: USB debugging + ADB (`KUAIYOU_ADB_SERIAL` if multiple devices).

## Preferred flow (MCP)

1. `capture_screenshot` and/or `get_ui_tree` to understand the current screen.
2. Draft a skill JSON that matches the project `schema.json` (local actions only: `tap`, `swipe`, `delay`, `storeValue`, `launchApp`, …).
3. `validate_kuaiyou_skill` — fix until valid.
4. `push_reactive_skill` — wait for the user to confirm import/run on the phone.
5. Iterate with natural language if the tap misses.

Do **not** use removed fields/actions: `agentId`, `readText`, `setClipboard`, `askAgent`.

## Fallback sync (no MCP push)

If MCP push is unavailable, save the skill JSON and sync manually:

### HTTP LAN

```bash
curl -X POST http://<DEVICE_IP>:8080/api/mcp/import \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "postData@/tmp/generated_skill.json"
```

### USB ADB

```bash
adb push /tmp/generated_skill.json /sdcard/Android/data/com.kuaiyou.automator.clicker/files/generated_skill.json
adb shell "chmod 666 /sdcard/Android/data/com.kuaiyou.automator.clicker/files/generated_skill.json"
adb shell am start -a android.intent.action.VIEW -d "kuaiyou://import_skill?path=/sdcard/Android/data/com.kuaiyou.automator.clicker/files/generated_skill.json"
```

Replace the package name if the installed app id differs.

## Example skill shape

```json
{
  "id": "my_unique_skill_id",
  "name": "My skill",
  "description": "What this skill does",
  "executionMode": "REACTIVE",
  "goals": []
}
```

## How users invoke this Agent Skill

- **Claude Code**: `/autoace` or rely on description match
- **Codex**: `$autoace` or `/skills`
- **Cursor**: skill auto-loads when relevant if installed under project/user skills
