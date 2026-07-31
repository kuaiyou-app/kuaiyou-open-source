# 快游大师 MCP / Agent Skill 使用教程

用自然语言在 Claude Code、Codex、Cursor 等工具里编写**技能**，经校验后下发到手机「快游大师」本地执行。

**面向 AI Agent 的短安装清单**（网站提示词入口）：  
https://kuaiyou-app.github.io/autoace-cli-installation-guide.md  

本文是给人/贡献者看的补充说明；安装步骤以该指南为准，避免多处各写一套。

## 名称约定（请先分清）

| 名称 | 是什么 | 用户怎么用 |
| --- | --- | --- |
| **autoace-cli** | 电脑端 MCP CLI（npm 包名同名） | MCP command：`npx -y autoace-cli@…` |
| **autoace** | Agent Skill（给 AI 的工作流说明） | `npx skills add … --skill autoace`；Claude `/autoace`；Codex `$autoace` |
| **技能** | 手机端执行的自动化 JSON | App 内导入/运行；不是装进 Claude 的文件 |

不要把 Agent Skill 和手机端「技能」混为一谈；面向用户统一说「技能」，不要使用内部协议花名。

---

## 组成

1. **快游大师 App（手机）**：截屏 / 节点树，本地执行技能。
2. **autoace-cli（电脑）**：MCP 工具——看屏、读取客户端实时契约、校验、推送技能。
3. **autoace（Agent Skill，可选但推荐）**：教 Agent 正确走 MCP / 调试闭环。
4. **AI 客户端**：Claude Code / Codex / Cursor / Claude Desktop 等。

---

## 环境准备

### 1. 手机端

1. 安装 **「快游大师」**：https://autoace.kuaiyou-app.com/download  
2. **设置 → 高级设置 → MCP 服务** 打开。  
3. 点击 MCP 服务条目，复制给 Agent 的完整连接配置（含 `IP:端口` 与配对码）。

### 2. 配置 autoace-cli

需 **Node.js ≥ 20、npm ≥ 10**。`autoace-cli` 是 stdio MCP server，应注册到 MCP 客户端，而不是只在普通终端前台运行。

包页：https://www.npmjs.com/package/autoace-cli  

> 旧 npm 包 `kuaiyou-mcp-server` 已废弃。请改用 `autoace-cli`。

局域网 HTTP 为当前唯一传输；**必须**配置 `KUAIYOU_DEVICE_IP`（含端口）与 `KUAIYOU_MCP_PAIRING_CODE`。不要假设 USB 可免 env / 自动发现设备。

---

## 在各客户端配置 MCP（必做）

把 App 复制的连接信息写入用户级或本地 MCP 配置。名称建议 **`autoace`**。不要把配对码写入项目仓库、日志或 Git 提交。

### Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "autoace": {
      "command": "npx",
      "args": ["-y", "autoace-cli@1.0.8"],
      "env": {
        "KUAIYOU_DEVICE_IP": "192.168.1.100:41899",
        "KUAIYOU_MCP_PAIRING_CODE": "482917"
      }
    }
  }
}
```

### Claude Code

在 Claude Code 的 MCP 配置中增加同上 `autoace` 条目。配置后**新开会话**，确认工具列表出现 `pair_device`、`get_ui_tree`、`push_reactive_skill` 等。

### Codex

在 `~/.codex/config.toml`（或当前版本 MCP 配置处）注册同等 command / args / env。

> **端口与配对码每次开启 MCP 服务都会变**：`KUAIYOU_DEVICE_IP` 必须带端口；重开服务后要重填。  
> 错码会 `429` + `Retry-After`。  
> 若 CLI 直连 `tools/list` 已有工具但会话目录没有：先**新开 Agent 对话**，再谈升级 CLI。

---

## 安装 Agent Skill：`autoace`（推荐）

权威目录：[`agent-skills/autoace/`](../agent-skills/autoace/)（`SKILL.md` + `reference.md` + `craft.md`）。默认分支 **`develop`**。

### 一键（推荐，与飞书同款）

```bash
npx -y skills add kuaiyou-app/kuaiyou-open-source --skill autoace -g -y
```

会安装整包 Skill 到各 Agent 目录。勿只 curl 单个 `SKILL.md`。

### 手动（Pages 镜像）

```bash
DEST="$HOME/.claude/skills/autoace"   # Codex: ~/.codex/skills/autoace ；Cursor: ~/.cursor/skills/autoace
mkdir -p "$DEST"
for f in SKILL.md reference.md craft.md; do
  curl -fsSL "https://kuaiyou-app.github.io/agent-skills/autoace/$f" -o "$DEST/$f"
done
```

### 本仓库开发同步

```bash
node scripts/sync-autoace-skill.mjs
node scripts/sync-autoace-skill.mjs --cursor-user
```

---

## 让 AI 写第一个技能

常用 MCP 工具：

- `pair_device`：会话开场配对并展示设备上下文（传入 App 复制全文）
- `get_kuaiyou_schema`：读取当前 App 的权威技能契约
- `get_ui_tree` / `capture_screenshot`
- `validate_kuaiyou_skill` / `push_reactive_skill`（对用户说「推送技能」）
- 调试：`list_skills` / `run_skill` / `get_skill_status` / `get_execution_log` / `stop_skill` / `delete_skill`
- 领域教练（需 App 支持）：`plans_schema` → `plans_validate` → `plans_deploy`

推荐顺序：配对开场 → 契约 → 看屏 → 稳定选择器 → 校验 → 推送 → 不准则看 log/UI。仓库示例不是契约定义。

示例提示词：

> 请用 autoace MCP：先 pair_device（我粘贴了连接信息），读取当前客户端技能契约，再截屏并获取 UI 树，写一个自动点击「每日签到」的技能，校验通过后推送到手机。

仓库 `examples/`、`skills/` 是参考 JSON，**不是** Agent Skill。
