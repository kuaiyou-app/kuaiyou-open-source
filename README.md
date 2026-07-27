# Kuaiyou Open Source (快游大师开源生态)

<div align="center">
  <img src="https://via.placeholder.com/800x200?text=Kuaiyou+Master+Open+Source" alt="Kuaiyou Master Logo">
  <h3>用 AI 编写 Android 端侧自动化技能（MCP + 快游大师）</h3>
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

本仓库提供电脑端 CLI（**autoace-cli**）、技能 Schema 与示例。配合手机端「快游大师」App，可在 Cursor 等 AI 客户端里用自然语言生成**技能**，校验后下发到手机本地执行。

> **说明**：
> Android 客户端（无障碍执行引擎等）为闭源，请在应用商店搜索 **「快游大师」** 下载。
> **开源官网**：[`kuaiyou-app/kuaiyou-website`](https://github.com/kuaiyou-app/kuaiyou-website) → https://kuaiyou-app.github.io/kuaiyou-website/

---

## 核心能力

- **弹窗拦截**：高优先级识别并关闭青少年模式、更新提示、广告等打断主流程的弹窗。
- **语义点击**：通过 `semantic`（如「去签到」）结合无障碍树定位，减少绝对坐标依赖。
- **百分比坐标与相对滑动**：适配不同分辨率；可在指定面板内相对滑动。
- **本地执行**：动作在设备本地闭环（`tap` / `swipe` / `launchApp` / `delay` 等）；读写请用 `storeValue`，勿用已移除的 `readText` / `setClipboard`。
- **MCP 联调**：`autoace-cli` 供 AI 看屏、校验并下发技能。

---

## 仓库导航

| 目录/模块 | 描述 |
| --- | --- |
| **[autoace-cli](./kuaiyou-mcp-server/)** | 电脑端 MCP CLI（npm 包名 `autoace-cli`）。 |
| **[schema.json](./schema.json)** | 技能 JSON 契约（由客户端 release 导出，本仓库为镜像）。 |
| **[docs](./docs/)** | 编写与联调手册；完整接入见 [mcp-ecosystem-tutorial.md](./docs/mcp-ecosystem-tutorial.md)。 |
| **[examples](./examples/)** | 技能示例 JSON。 |
| **[skills](./skills/)** | 社区技能 JSON（装进 App，不是 Agent Skill）。 |
| **[agent-skills/autoace](./agent-skills/autoace/)** | Agent Skill **`autoace`**（Claude Code `/autoace`、Codex `$autoace`）。 |
| **[kuaiyou-website](https://github.com/kuaiyou-app/kuaiyou-website)** | 独立开源官网（GitHub Pages）。 |

---

## 快速开始

### 1. 准备手机端
- 安装最新版 **「快游大师」**。
- 打开 **设置 → 高级设置 → MCP 服务**，开启开关。
- 副标题显示地址与配对码；**点击该条目**可复制给 Agent 的连接信息。
- *(当前仅支持局域网 HTTP 通道，手机与电脑需在同一网络。)*

### 2. 配置 autoace-cli
需 **Node.js ≥ 18**。npm 包名：**`autoace-cli`**。

```bash
# 局域网（替换为 App 显示的 IP:端口 与配对码）
KUAIYOU_DEVICE_IP=192.168.1.100:3847 KUAIYOU_MCP_PAIRING_CODE=482917 npx -y autoace-cli
```

也可：`npm install -g autoace-cli`。

推荐同时安装 Agent Skill **`autoace`**（见 [教程](./docs/mcp-ecosystem-tutorial.md)），在 Claude Code 用 `/autoace`，在 Codex 用 `$autoace`。

> 配对码通过 `Authorization: Bearer` 发送（兼容旧变量名 `KUAIYOU_MCP_TOKEN`）。

### 3. 向 AI 下达指令
> 「请查看我现在的手机界面，写一个点击『去签到』的技能，并推送到手机上运行。」

手机会弹出导入确认；确认后本地执行。

---

## 参与贡献

- Bug / 建议：[GitHub Issues](https://github.com/kuaiyou-app/kuaiyou-open-source/issues)
- 官网相关：[`kuaiyou-website`](https://github.com/kuaiyou-app/kuaiyou-website/issues)
- 贡献流程：[CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 开源协议

Apache License 2.0。
