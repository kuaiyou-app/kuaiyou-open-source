# 快游大师 MCP 生态使用教程：端到端热重载开发

在传统的 Android 自动化脚本开发中，开发者往往需要繁琐地导出 UI 节点、手动编写代码、重新编译和推送到设备，开发周期极其漫长。

现在，借助于**模型上下文协议 (Model Context Protocol, MCP)** 以及快游大师强大的 `ReactiveSkill` 动态解析引擎，您可以直接在电脑端的 Cursor 或 Claude 桌面版中，让 AI 帮您“看”屏幕、“想”逻辑、“写” JSON，并且**瞬间热重载**到手机上执行！

## 核心原理解析

这套基于 AI 的端到端热重载体系由三部分组成：
1. **快游大师 App（手机端）**：内置基于无障碍服务的 `ReactiveExecutionEngine` 与微型 HTTP Server，负责提供截屏/节点树和执行传入的 `ReactiveSkill` 任务。
2. **autoace-cli（PC 端中介）**：已发布到 [npm](https://www.npmjs.com/package/autoace-cli)。连接 AI 与手机，通过局域网 (HTTP) 或 USB (ADB) 获取手机状态，并将技能推送到手机。
3. **Cursor / Claude Desktop（AI 客户端）**：作为超级大脑，根据用户的自然语言需求和当前屏幕状态，自动编写和修改自动化代码。

---

## 环境准备

### 1. 手机端配置
1. 在各大手机应用商店（如华为、小米、应用宝等）搜索并安装最新版 **“快游大师”**。
2. 打开 **设置 → 高级设置 → MCP 服务**，打开开关。
3. 副标题分两行显示地址（如 `http://192.168.1.100:3847`）与配对码；**点击该条目**可复制给 Agent 的连接命令。
*(若无法使用局域网，可通过数据线连接电脑并开启 USB 调试，MCP Server 会回退到 ADB。)*

### 2. PC 端安装 / 启动 MCP Server
需要 **Node.js ≥ 18**。包已在 npm 公开：

```bash
# 临时运行（推荐，自动下载最新版）
npx -y autoace-cli

# 或全局安装
npm install -g autoace-cli
```

包页：https://www.npmjs.com/package/autoace-cli

**在 Cursor 中配置：**
1. 打开 Cursor Settings → Features → MCP。
2. 点击 **+ Add New MCP Server**。
3. Name 填写 `kuaiyou`。
4. Type 选择 `command`。
5. Command 填写（把 IP:端口 / 配对码换成 App 里显示的值）：
   ```bash
   KUAIYOU_DEVICE_IP=192.168.1.100:3847 KUAIYOU_MCP_PAIRING_CODE=482917 npx -y autoace-cli
   ```

**在 Claude Desktop 中配置：**
修改您的 `claude_desktop_config.json`：
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

> `KUAIYOU_DEVICE_IP` 支持 `ip` 或 `ip:port`（未写端口时默认 `8080`）。配对码也可用旧环境变量名 `KUAIYOU_MCP_TOKEN`。

---

## 实战演练：让 AI 帮你写个自动化脚本

配置完成后，打开 Cursor 的 Composer 或 Claude 对话框。快游大师提供了以下几个强大的内置 MCP 工具：
- `get_ui_tree`：获取手机当前界面的无障碍节点树。
- `capture_screenshot`：截取当前手机屏幕图像。
- `push_reactive_skill`：向手机瞬间推送新的自动化任务并自动弹窗执行。
- `validate_kuaiyou_skill`：验证大模型生成的 JSON 格式。

### 尝试发送你的第一个指令
你可以直接对 AI 这样说：
> “请使用 `capture_screenshot` 和 `get_ui_tree` 看看我现在手机的界面，帮我写一个自动点击‘每日签到’的 ReactiveSkill JSON，然后用 `push_reactive_skill` 推送到我手机上运行。”

**接下来发生的事情会让你惊叹：**
1. AI 自动调用工具，获取了您手机的界面节点和图片。
2. AI 分析屏幕上的可交互元素并生成符合规范的 `ReactiveSkill` JSON（使用 `tap` / `storeValue` 等本地动作）。
3. AI 调用 `push_reactive_skill`。
4. 你的手机弹出导入确认；确认后即可本地执行。

如果过程有任何偏差，你只需要告诉 AI 调整目标或动作，再推送一次。**这就是快游大师 MCP 生态带来的极致开发体验！**
