---
name: kuaiyou-agent-sync
description: Sync a generated skill JSON to Kuaiyou Master App via ADB or HTTP
---

# Sync skill to Kuaiyou Master

When you generate a skill JSON for the Kuaiyou Master Android app, use this flow to push it to the device and open the import confirmation dialog.

```json
{
  "id": "my_unique_skill_id",
  "name": "My AI Generated Skill",
  "description": "This skill automatically ...",
  "executionMode": "REACTIVE"
}
```

## Requirements

- Android device connected via ADB (for USB path), or same LAN with MCP service enabled (for HTTP path).
- `adb` on PATH when using USB.

## Execution Steps

### Option A: HTTP LAN (Recommended)

If Kuaiyou Master is on the same network and MCP service is enabled (e.g. `192.168.1.100`):

1. Save the skill JSON, e.g. `/tmp/generated_skill.json`.
2. POST it:
   ```bash
   curl -X POST http://<DEVICE_IP>:8080/api/mcp/import \
     -H "Content-Type: application/x-www-form-urlencoded" \
     --data-urlencode "postData@/tmp/generated_skill.json"
   ```
3. Confirm import in the app when prompted.

### Option B: USB ADB

1. Save the skill JSON, e.g. `/tmp/generated_skill.json`.

2. Push into the app sandbox (package is usually `com.kuaiyou.automator.clicker`):

   ```bash
   adb push /tmp/generated_skill.json /sdcard/Android/data/com.kuaiyou.automator.clicker/files/generated_skill.json
   adb shell "chmod 666 /sdcard/Android/data/com.kuaiyou.automator.clicker/files/generated_skill.json"
   ```

3. Open the import deep link:

   ```bash
   adb shell am start -a android.intent.action.VIEW -d "kuaiyou://import_skill?path=/sdcard/Android/data/com.kuaiyou.automator.clicker/files/generated_skill.json"
   ```

4. Confirm import in the app.
