# Kuaiyou Open Source (快游大师开源生态)

<div align="center">
  <img src="https://via.placeholder.com/800x200?text=Kuaiyou+Master+Open+Source" alt="Kuaiyou Master Logo">
  <h3>下一代基于大模型与 MCP 协议的 Android 端侧响应式自动化 (Reactive Automation) 生态</h3>
  <br />
  <a href="https://github.com/kuaiyou-app/kuaiyou-open-source">
    <img src="https://img.shields.io/github/stars/kuaiyou-app/kuaiyou-open-source?style=social" alt="GitHub Repo stars" />
  </a>
  <a href="https://www.npmjs.com/package/autoace-cli">
    <img src="https://img.shields.io/npm/v/autoace-cli.svg" alt="npm version" />
  </a>
  <a href="https://github.com/kuaiyou-app/kuaiyou-open-source/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License" />
  </a>
  <a href="https://kuaiyou-app.github.io/kuaiyou-website/">
    <img src="https://img.shields.io/badge/Website-GitHub%20Pages-blue.svg" alt="Website" />
  </a>
</div>

---

欢迎来到 **快游大师 (Kuaiyou Master)** 官方开源仓库！

我们致力于打破传统的端侧自动化壁垒。通过这套完全开源的 MCP 中介服务与标准化技能库，您可以让 **Cursor、Claude** 等任何支持 MCP (Model Context Protocol) 协议的 AI 助理，直接“看到”并“操控”您的 Android 手机，从而实现**零代码、一句话、秒级热重载**的自动化脚本开发。

> **⚠️ 注意**：
> 快游大师的 Android 客户端本体（包含底层的无障碍执行引擎与商业化模块）为闭源项目。您可以在各大安卓应用商店（华为、小米、应用宝等）搜索 **“快游大师”** 免费下载。
> **本仓库包含了与该 App 配套的 MCP 服务端、通信协议 (Schema) 以及社区共建的技能案例库。**
> **开源官网**已独立发布：[`kuaiyou-app/kuaiyou-website`](https://github.com/kuaiyou-app/kuaiyou-website) → https://kuaiyou-app.github.io/kuaiyou-website/

---

## 🌟 核心特性与 V2 架构升级

在最新的 V2 架构中，我们对底层的 ReactiveSkill 引擎进行了全面升级，带来了更稳定、更纯粹的本地化执行体验：

- 🛡️ **全局弹窗拦截 (Interrupts)**：采用独立高优先级线程，随时随地智能识别并关闭各种不可预期的弹窗（如青少年模式、版本更新、广告等），不再打断主流程。
- 🎯 **基于无障碍树的语义点击**：抛弃脆弱的绝对坐标，支持直接通过 `semantic`（如“去签到按钮”）描述目标，系统底层结合无障碍 (Accessibility) 树和端侧小模型进行精准定位与点击。
- 📏 **坐标百分比与相对滑动**：针对不同分辨率的设备，支持 `startXPct` 等百分比坐标；支持在一个特定 UI 面板（如评论区）内进行精准的相对滑动操作。
- 🔒 **严格的本地化执行**：全面移除对外部大模型运行期调用的依赖（剔除了旧版的 `agentId` 字段，严格拦截 `askAgent` 动作），所有的动作指令（`tap`, `swipe`, `launchApp`, `delay`）都在设备本地极速闭环，大幅提升运行流畅度并节省云端 Token。
- 🤖 **大模型原生的 MCP 集成**：通过我们提供的 `autoace-cli`，AI 可在 PC 编排端随时提取 Android 屏幕结构、计算中心点坐标，并秒级下发调试脚本，实现完美的“PC 编排 - 端侧运行”联调闭环。

---

## 📦 仓库导航

| 目录/模块 | 描述 |
| --- | --- |
| **[autoace-cli](./kuaiyou-mcp-server/)** | 核心 Node.js 服务端（MCP 协议）。打通 PC 编排与 Android 实机联调，向 AI 暴露节点提取、截图和脚本下发能力。 |
| **[schema.json](./schema.json)** | 手写权威 `ReactiveSkill` JSON Schema（LLM/App 契约）。V2 不含 `agentId`，也不声明已移除的 `readText`/`setClipboard`。 |
| **[docs](./docs/)** | 详尽的开发者指南，包含 V2 技能编写与联调手册、避坑指南等。 |
| **[examples](./examples/)** | 规范的 V2 技能脚本示例，包含无限刷视频、智能互动等。 |
| **[skills](./skills/) / [agent-skills](./agent-skills/)** | 社区共建脚本库及供 AI (Claude/Cursor) 挂载的技能提示词。 |
| **[kuaiyou-website](https://github.com/kuaiyou-app/kuaiyou-website)** | 独立开源官网（GitHub Pages）。 |

---

## 🚀 快速开始

想要体验“对 AI 说话就能写出 Android 自动化脚本”的震撼流程？只需三步：

### 1. 准备手机端
- 在应用商店下载并安装最新版 **“快游大师”**。
- 打开 **设置 → 高级设置 → MCP 服务**，开启开关。
- 副标题会显示地址与配对码；**点击该条目**可复制给 Agent 的连接信息。
- *(如果没有局域网环境，请开启 Android 的 USB 调试并连上数据线，系统会自动回退到 ADB 模式。多设备时设置 `KUAIYOU_ADB_SERIAL`。)*

### 2. 在 AI 助理中配置 MCP Server
`autoace-cli` 已发布到 npm（[autoace-cli](https://www.npmjs.com/package/autoace-cli)）。需 **Node.js ≥ 18**。

在 Cursor (Settings → Features → MCP) 或 Claude Desktop 配置中，添加一个 Command 类型的服务器：

```bash
# 局域网直连（推荐）：设备 IP:端口 + App 显示的 6 位配对码
KUAIYOU_DEVICE_IP=192.168.1.100:3847 KUAIYOU_MCP_PAIRING_CODE=482917 npx -y autoace-cli

# USB 数据线直连模式 (Fallback，可选指定序列号)
KUAIYOU_ADB_SERIAL=<serial> npx -y autoace-cli
```

也可全局安装：`npm install -g autoace-cli`。

> 配对码通过 `Authorization: Bearer` 发送（也兼容旧环境变量名 `KUAIYOU_MCP_TOKEN`）；读写技能请使用 `storeValue`，不要使用已移除的 `readText` / `setClipboard`。

### 3. 开始向 AI 下达指令！
回到对话框，直接向 AI 说：
> “请使用工具查看我现在的手机界面，然后写一个点击‘去签到’按钮的 JSON 脚本，并推送到我的手机上运行。”

您的手机会立刻弹出导入窗口并开始自动化点击，开发就是如此简单优雅！

---

## 🤝 参与贡献

我们极其渴望极客玩家和开发者们参与到这套全新生态的建设中来！无论您是优化 MCP Server，还是想把刚用 AI 生成的实用自动化 JSON 分享给大家，我们都热烈欢迎！

- 🐛 **提交 Bug 或建议**: 欢迎在 [GitHub Issues](https://github.com/kuaiyou-app/kuaiyou-open-source/issues) 留言。
- 🌐 **官网相关**: 请到 [`kuaiyou-website`](https://github.com/kuaiyou-app/kuaiyou-website/issues) 提 Issue。
- 📖 **贡献代码与脚本**: 请查阅我们的 [贡献指南 (CONTRIBUTING.md)](./CONTRIBUTING.md) 了解如何向仓库提交 PR。

---

## 📄 开源协议

本项目下的所有代码、文档及 JSON 技能库均采用 **Apache License 2.0** 协议开源。
您可以自由地使用、修改和分发，但请保留相关的版权声明。
