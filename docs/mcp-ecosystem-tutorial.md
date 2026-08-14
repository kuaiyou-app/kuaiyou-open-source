# 快游大师 MCP / Agent Skill 使用教程

用自然语言编写**技能**，校验后下发到手机「快游大师」执行。

**Agent 安装入口**：https://kuaiyou-app.github.io/autoace-cli-installation-guide.md  

安装步骤以该指南为准；本文仅补充名称与使用要点。

## 名称

| 名称 | 是什么 |
| --- | --- |
| **autoace-cli** | 电脑端 MCP CLI |
| **autoace** | Agent Skill（工作流说明） |
| **技能** | 手机端自动化 JSON |

## 安装摘要

```bash
npm install -g autoace-cli@latest
npx -y skills add kuaiyou-app/kuaiyou-open-source --skill autoace -g -y
```

MCP 名称建议 `autoace`。env 可填 App 复制的 `KUAIYOU_DEVICE_IP`（含端口）与 `KUAIYOU_MCP_PAIRING_CODE`，也可留空后把「复制给 Agent」交给 `pair_device`（成功后写入本机配置）。配对码不进仓库。无 USB 自动发现。

端口/配对码每次开启 MCP 会变。会话缺工具但 CLI `tools/list` 已有 → 新开对话。

## 写技能

`pair_device` → `get_kuaiyou_prompts` + `get_kuaiyou_schema` → `observe_screen`（无此工具则截屏 + UI 树）→ 起草 → `validate_kuaiyou_skill` → `push_reactive_skill`（手机确认；可 `run: true` 等到结束）→ 不准则看返回的 log / 截屏后再 `observe_screen`。

契约只认设备；`examples/` 与 `skills/` 是用法参考和社区目录，不是契约。引擎回归夹具在 `autoace-cli/fixtures/device/`。领域教练需 App 支持 `plans_*`。
