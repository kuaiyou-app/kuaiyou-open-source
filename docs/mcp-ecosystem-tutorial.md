# 快游大师 MCP 使用教程

用 **MCP** + 手机端「快游大师」，在 Cursor 等 AI 客户端里用自然语言生成**技能**，校验后下发到手机本地执行。

## 组成

1. **快游大师 App（手机）**：提供截屏 / 无障碍节点树，并本地执行技能。
2. **autoace-cli（电脑）**：连接 AI 与手机（局域网 HTTP 或 USB ADB），校验并推送技能。
3. **AI 客户端**：根据自然语言与当前界面编排技能。

---

## 环境准备

### 1. 手机端

1. 应用商店安装 **「快游大师」**。
2. 打开 **设置 → 高级设置 → MCP 服务**。
3. 副标题显示地址与配对码；**点击该条目**可复制连接命令。
*(无局域网时可用 USB 调试。)*

### 2. 安装 / 启动 autoace-cli

需 **Node.js ≥ 18**。

```bash
npx -y autoace-cli

# 或全局安装
npm install -g autoace-cli
```

包页：https://www.npmjs.com/package/autoace-cli

**Cursor：** Settings → Features → MCP → Add，Type 选 `command`，例如：

```bash
KUAIYOU_DEVICE_IP=192.168.1.100:3847 KUAIYOU_MCP_PAIRING_CODE=482917 npx -y autoace-cli
```

**Claude Desktop**（`claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "kuaiyou": {
      "command": "npx",
      "args": ["-y", "autoace-cli"],
      "env": {
        "KUAIYOU_DEVICE_IP": "192.168.1.100:3847",
        "KUAIYOU_MCP_PAIRING_CODE": "482917"
      }
    }
  }
}
```

> `KUAIYOU_DEVICE_IP` 支持 `ip` 或 `ip:port`（默认端口 `8080`）。配对码也可用旧变量名 `KUAIYOU_MCP_TOKEN`。

---

## 让 AI 写第一个技能

常用工具：

- `get_ui_tree`：当前界面无障碍节点树
- `capture_screenshot`：截屏
- `push_reactive_skill`：推送技能并弹窗确认
- `validate_kuaiyou_skill`：校验技能 JSON

示例提示词：

> 「请用 `capture_screenshot` 和 `get_ui_tree` 看当前界面，写一个自动点击『每日签到』的技能，再用 `push_reactive_skill` 推送到手机。」

流程：看屏 → 生成符合 `schema.json` 的技能（`tap` / `storeValue` 等）→ 推送 → 手机确认后本地执行。需要调整时，改目标或动作后再推一次即可。
