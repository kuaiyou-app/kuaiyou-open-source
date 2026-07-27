# 快游大师 MCP / Agent Skill 使用教程

用自然语言在 Claude Code、Codex、Cursor 等工具里编写**技能**，经校验后下发到手机「快游大师」本地执行。

## 名称约定（请先分清）

| 名称 | 是什么 | 用户怎么用 |
| --- | --- | --- |
| **autoace-cli** | 电脑端 MCP CLI（npm 包名同名） | `npx -y autoace-cli` / MCP command |
| **autoace** | Agent Skill（给 AI 的工作流说明，`SKILL.md`） | Claude Code `/autoace`；Codex `$autoace` |
| **技能** | 手机端执行的自动化 JSON | App 内导入/运行；不是装进 Claude 的文件 |

不要把 Agent Skill 和手机端「技能」混为一谈；面向用户统一说「技能」，不要使用内部协议花名。

---

## 组成

1. **快游大师 App（手机）**：截屏 / 节点树，本地执行技能。
2. **autoace-cli（电脑）**：MCP 工具——看屏、校验、推送技能。
3. **autoace（Agent Skill，可选）**：教 Agent 正确走 MCP / 回退同步流程。
4. **AI 客户端**：Claude Code / Codex / Cursor / Claude Desktop 等。

---

## 环境准备

### 1. 手机端

1. 安装 **「快游大师」**。
2. **设置 → 高级设置 → MCP 服务** 打开。
3. 点击该条目，复制 IP:端口与配对码。

### 2. 安装 autoace-cli

需 **Node.js ≥ 18**。

```bash
npx -y autoace-cli
# 或
npm install -g autoace-cli
```

包页：https://www.npmjs.com/package/autoace-cli

> 旧 npm 包 `kuaiyou-mcp-server` 已废弃。如果你之前 `npm install -g kuaiyou-mcp-server`，请卸载后改装 `autoace-cli`；`kuaiyou-mcp-server` 命令仍由新包提供，现有 MCP 配置无需修改。

---

## 在各客户端配置 MCP（必做）

把下面的 IP / 配对码换成 App 显示的值。MCP server 名称建议用 **`autoace`**。

### Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "autoace": {
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

### Claude Code

在 Claude Code 的 MCP 配置中增加同上 `autoace` 条目（command / args / env 相同）。配置后重启会话，确认工具列表出现 `get_ui_tree`、`push_reactive_skill` 等。

### Codex

在 `~/.codex/config.toml`（或当前 Codex 版本的 MCP 配置处）注册同等 MCP：command=`npx`，args=`["-y","autoace-cli"]`，并写入上述 env。

> `KUAIYOU_DEVICE_IP` 支持 `ip` 或 `ip:port`（默认端口 `8080`）。配对码兼容旧变量名 `KUAIYOU_MCP_TOKEN`。当前仅支持局域网 HTTP 通道，手机与电脑需在同一网络；App 重启后地址与配对码可能变化，需重新填写。

---

## 安装 Agent Skill：`autoace`（推荐）

源文件：[`agent-skills/autoace/SKILL.md`](../agent-skills/autoace/SKILL.md)

### Claude Code

```bash
mkdir -p ~/.claude/skills/autoace
curl -fsSL \
  https://raw.githubusercontent.com/kuaiyou-app/kuaiyou-open-source/main/agent-skills/autoace/SKILL.md \
  -o ~/.claude/skills/autoace/SKILL.md
```

项目内共享可放到 `.claude/skills/autoace/SKILL.md`。调用：`/autoace`。

### Codex

```bash
mkdir -p ~/.codex/skills/autoace
curl -fsSL \
  https://raw.githubusercontent.com/kuaiyou-app/kuaiyou-open-source/main/agent-skills/autoace/SKILL.md \
  -o ~/.codex/skills/autoace/SKILL.md
```

或项目内：`.agents/skills/autoace/SKILL.md`。调用：`$autoace` 或 `/skills`。若技能未启用，在 `~/.codex/config.toml` 打开 skills 相关开关后重启。

### Cursor

将 `agent-skills/autoace` 复制到项目的 Agent Skills 目录（或个人 skills 目录），保存后新开 Agent 会话即可。

### 一键（若已装 skills CLI）

```bash
npx skills add kuaiyou-app/kuaiyou-open-source --path agent-skills/autoace
```

---

## 让 AI 写第一个技能

常用 MCP 工具：

- `get_ui_tree` / `capture_screenshot`
- `validate_kuaiyou_skill`
- `push_reactive_skill`
- （可选）`list_skills` / `run_skill` / `stop_skill` …

示例提示词：

> 请用 autoace MCP：先截屏并获取 UI 树，写一个自动点击「每日签到」的技能，校验通过后推送到手机。

手机弹出确认后本地执行；不准就继续用自然语言改再推。

仓库 `examples/`、`skills/` 是参考 JSON，**不是**装进 Claude Code 的 Agent Skill。
