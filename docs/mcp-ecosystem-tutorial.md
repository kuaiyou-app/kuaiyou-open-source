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
2. **autoace-cli（电脑）**：MCP 工具——看屏、读取客户端实时契约、校验、推送技能。
3. **autoace（Agent Skill，可选）**：教 Agent 正确走 MCP / 回退同步流程。
4. **AI 客户端**：Claude Code / Codex / Cursor / Claude Desktop 等。

---

## 环境准备

### 1. 手机端

1. 安装 **「快游大师」**。
2. **设置 → 高级设置 → MCP 服务** 打开。
3. 副标题默认遮罩配对码；需要人工查看时点眼睛图标。点击 MCP 服务条目，可复制给 Agent 的完整 stdio 连接配置。

### 2. 配置 autoace-cli

需 **Node.js ≥ 20、npm ≥ 10**。`autoace-cli` 是 stdio MCP server，应注册到 MCP 客户端，而不是只在普通终端前台运行。

包页：https://www.npmjs.com/package/autoace-cli

> 旧 npm 包 `kuaiyou-mcp-server` 已废弃。如果你之前 `npm install -g kuaiyou-mcp-server`，请卸载后改装 `autoace-cli`；`kuaiyou-mcp-server` 命令仍由新包提供，现有 MCP 配置无需修改。

---

## 在各客户端配置 MCP（必做）

点击 App 的 MCP 服务条目，把复制内容粘贴给 Agent；它会按当前客户端格式注册下面这组用户级或本地配置。MCP server 名称建议用 **`autoace`**。不要把配对码写入项目仓库、日志或 Git 提交。

### Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "autoace": {
      "command": "npx",
      "args": ["-y", "autoace-cli"],
      "env": {
        "KUAIYOU_DEVICE_IP": "192.168.1.100:41899",
        "KUAIYOU_MCP_PAIRING_CODE": "482917"
      }
    }
  }
}
```

### Claude Code

在 Claude Code 的 MCP 配置中增加同上 `autoace` 条目（command / args / env 相同）。配置后重启会话，确认工具列表出现 `get_kuaiyou_schema`、`get_ui_tree`、`push_reactive_skill` 等。

### Codex

在 `~/.codex/config.toml`（或当前 Codex 版本的 MCP 配置处）注册同等 MCP：command=`npx`，args=`["-y","autoace-cli"]`，并写入上述 env。

> **端口与配对码每次开启 MCP 服务都会变**：端口由系统临时分配，配对码是新生成的 6 位数字。
> 因此 `KUAIYOU_DEVICE_IP` **必须带端口**（`ip:port`），并且每次重开服务后都要按 App 上的新值重填这两个环境变量；
> 点击 App 里的「MCP 服务」条目可一次性复制完整 stdio 配置；Android 13+ 会把这段剪贴板内容标记为敏感。配对码兼容旧变量名 `KUAIYOU_MCP_TOKEN`。
> 当前仅支持局域网 HTTP 通道，手机与电脑需在同一网络。
> CLI 已支持 `KUAIYOU_DEVICE_URL=https://host:port`，供未来支持 TLS 的客户端优先使用；HTTP 模式请仅在可信、隔离的局域网内使用。
>
> 配对码连续输错会触发设备端退避（返回 `429` 并带 `Retry-After`），等提示的秒数后用当前配对码重试即可。配置后请重载 MCP；若当前会话不能热加载，则重启会话。

---

## 安装 Agent Skill：`autoace`（推荐）

权威目录：[`agent-skills/autoace/`](../agent-skills/autoace/)（`SKILL.md` + `reference.md` + `craft.md`）。请整目录安装，不要只拉单个 `SKILL.md`。

### Claude Code

```bash
mkdir -p ~/.claude/skills/autoace
for f in SKILL.md reference.md craft.md; do
  curl -fsSL \
    "https://raw.githubusercontent.com/kuaiyou-app/kuaiyou-open-source/main/agent-skills/autoace/$f" \
    -o "$HOME/.claude/skills/autoace/$f"
done
```

项目内共享可放到 `.claude/skills/autoace/`。调用：`/autoace`。

### Codex

```bash
mkdir -p ~/.codex/skills/autoace
for f in SKILL.md reference.md craft.md; do
  curl -fsSL \
    "https://raw.githubusercontent.com/kuaiyou-app/kuaiyou-open-source/main/agent-skills/autoace/$f" \
    -o "$HOME/.codex/skills/autoace/$f"
done
```

或项目内：从仓库根执行 `node scripts/sync-autoace-skill.mjs`（同步到 `.agents/skills/autoace/`）。调用：`$autoace` 或 `/skills`。若技能未启用，在 `~/.codex/config.toml` 打开 skills 相关开关后重启。

### Cursor

```bash
# 项目内（Codex/兼容目录）
node scripts/sync-autoace-skill.mjs

# 个人 Cursor skills
node scripts/sync-autoace-skill.mjs --cursor-user
```

或手动将整个 `agent-skills/autoace` 复制到项目 / 个人 skills 目录，保存后新开 Agent 会话。

### 一键（若已装 skills CLI）

```bash
npx skills add kuaiyou-app/kuaiyou-open-source --skill autoace
```

MCP 建议钉版本以免 npx 缓存过旧：`args: ["-y", "autoace-cli@1.0.8"]`（或当前最新）。

---

## 让 AI 写第一个技能

常用 MCP 工具：

- `pair_device`：会话开场配对并展示设备上下文（传入 App 复制全文）
- `get_kuaiyou_schema`：读取当前 App 的权威技能契约
- `get_ui_tree` / `capture_screenshot`
- `validate_kuaiyou_skill`：重新获取客户端契约并校验
- `push_reactive_skill`：校验通过后推送（对用户说「推送技能」）
- 调试：`list_skills` / `run_skill` / `get_skill_status` / `get_execution_log` / `stop_skill` / `delete_skill`
- 领域教练（需 App 支持）：`plans_schema` → `plans_validate` → `plans_deploy`

推荐顺序：配对开场 → 读取实时契约 → 看屏 → 按稳定选择器生成技能 → 校验 → 推送 → 不准则看 log/UI 再改。仓库中的示例不是契约定义；如果 App 未开启 MCP 服务或 `/api/mcp/schema` 不可用，CLI 不会使用本地文件兜底。

示例提示词：

> 请用 autoace MCP：先 pair_device（我粘贴了连接信息），读取当前客户端技能契约，再截屏并获取 UI 树，写一个自动点击「每日签到」的技能，校验通过后推送到手机。

手机弹出确认后本地执行；不准就根据执行日志和 UI 树改选择器再推。

仓库 `examples/`、`skills/` 是参考 JSON，**不是**装进 Claude Code 的 Agent Skill。