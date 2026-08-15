# Kuaiyou Open Source（快游大师开源生态）

<div align="center">
  <img src="docs/assets/logo.png" alt="Kuaiyou Master Logo" width="120">
  <h2>The Agentic Skills</h2>
  <p>把写 Android 自动化技能这件事交给 Agent：你说需求，它看屏、校验、推到手机。</p>
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
  <a href="https://kuaiyou-app.github.io/">
    <img src="https://img.shields.io/badge/Website-Kuaiyou%20Master-blue.svg" alt="Website" />
  </a>
</div>

---

## 亮点

- 🤖 **Agent 原生** — 看屏、写技能 JSON、校验、推送、等跑完看 log，都由 Agent 调 MCP 完成。
- ⚡ **一行安装** — `npx skills add` 装 Agent Skill，再让 Agent 配 CLI 与 MCP。
- 📱 **手机本地执行** — 技能在快游大师里跑，不依赖云端模型一直在线；导入/运行须你在手机上确认。
- 🌐 **适配多种 Agent** — Cursor、Claude Code、Codex 等支持 [Agent Skills](https://agentskills.io) / MCP 的客户端即可。

Android 客户端（无障碍执行引擎）为闭源，请在应用商店搜索 **「快游大师」**。开源官网：https://kuaiyou-app.github.io/ （源码：[`kuaiyou-website`](https://github.com/kuaiyou-app/kuaiyou-website)）。

---

## 快速开始

### 让 Agent 来搞定（推荐）

手机先装快游大师，打开 **设置 → 高级设置 → MCP 服务**。把下面整段发给 Cursor / Claude Code / Codex：

```
帮我安装快游大师 CLI 与 Agent Skill，并配置 MCP：
https://kuaiyou-app.github.io/autoace-cli-installation-guide.md
```

装好后**新开一条对话**，把 App「复制给 Agent」全文交给它，先 `pair_device`。成功后本机保存地址，不必为换地址改 mcp.json。

### 手动安装

需要 Node.js ≥ 20、npm ≥ 10。

```bash
npm install -g autoace-cli@latest
npx -y skills add kuaiyou-app/kuaiyou-open-source --skill autoace -g -y
```

在 AI 客户端注册 stdio MCP（名称建议 `autoace`）。env 可省略，首次把「复制给 Agent」交给 `pair_device` 即可：

```text
serverName: autoace
transport: stdio
command: autoace-cli
args: []
env:
  KUAIYOU_DEVICE_IP: "<DEVICE_IP:PORT>"
  KUAIYOU_MCP_PAIRING_CODE: "<PAIRING_CODE>"
```

也可用 `command: npx` + `args: ["-y","autoace-cli@latest"]`。不要只在普通终端前台跑 stdio server，也不要把配对码提交到 Git。端口与配对码每次开启 MCP 都会变。

---

## 能做什么

告诉 Agent 你要做什么——它负责 `observe_screen` 看屏、按设备契约写技能、校验后推到手机。

| 能力 | 试试这样说 |
| --- | --- |
| **打开应用** | 「看一下当前屏幕，写一个打开微信并等到首页出现的技能，校验后推到手机。」 |
| **关弹窗** | 「写一个技能：出现更新/确认类弹窗就点关闭或确认，跑完把 log 给我。」 |
| **文案签到** | 「屏幕出现『签到』时点一次就结束。先 observe_screen，再 validate 后 push，run:true 等到结束。」 |
| **点偏了再改** | 「没点中。用刚才的 log 和截屏改选择器，再推一版。」 |

默认主路径：`pair_device` → `observe_screen` → `get_kuaiyou_prompts` + `get_kuaiyou_schema` → `validate_kuaiyou_skill` → `push_reactive_skill`（可 `run: true` 等到结束；失败带截屏）。完整工具表见 Agent Skill [reference.md](./agent-skills/autoace/reference.md)。领域教练 `plans_*` 仅在你明确要求学习计划时使用。

禁止：`readText` / `setClipboard` / `askAgent`；读写用 `storeValue`。契约只认当前连接的 App，不要把仓库 JSON 当 Schema。

---

## 仓库里有什么

| 目录 | 是什么 |
| --- | --- |
| **[autoace-cli](./autoace-cli/)** | 电脑端 MCP CLI（npm：`autoace-cli`） |
| **[agent-skills/autoace](./agent-skills/autoace/)** | Agent Skill **`autoace`**（给 Cursor/Claude 的流程说明） |
| **[skills](./skills/)** | 可导入 App 的社区技能 JSON（打开微信/支付宝、关弹窗、文案签到） |
| **[examples](./examples/)** | 写法示例，不是契约 |
| **[docs](./docs/)** | 人读手册；接入见 [mcp-ecosystem-tutorial.md](./docs/mcp-ecosystem-tutorial.md) |

引擎回归夹具在 `autoace-cli/fixtures/device/`，不要当社区示范抄。

---

## 参与贡献

- **反馈 Bug** — [提 Issue](https://github.com/kuaiyou-app/kuaiyou-open-source/issues) 并附上复现步骤。
- **提需求** — 对新技能或 MCP 能力有想法，欢迎 Feature Request。
- **提交 PR** — 社区技能请按 [CONTRIBUTING.md](./CONTRIBUTING.md)；不要提交头条回归 / 无限刷视频。
- **官网** — [`kuaiyou-website`](https://github.com/kuaiyou-app/kuaiyou-website)

---

> **免责声明** — 技能会在你的手机上点击、滑动、打开应用。导入和运行都须你在 App 里确认。当前局域网通道多为 HTTP，请只在可信隔离网络使用；配对码和屏幕内容不要写入仓库。AI 生成的选择器在界面改版后会失效，请用 `observe_screen` 对着当前屏幕改。本项目按 Apache-2.0 提供，不保证可用性。

## 许可证

[Apache 2.0](./LICENSE)
