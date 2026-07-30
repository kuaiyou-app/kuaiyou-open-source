# 安全策略 (Security Policy)

## 报告漏洞 (Reporting a Vulnerability)

**请不要在公开的 GitHub Issue 中报告安全漏洞。**

请通过 GitHub 私密安全公告渠道提交漏洞报告：
[github.com/kuaiyou-app/kuaiyou-open-source/security/advisories/new](https://github.com/kuaiyou-app/kuaiyou-open-source/security/advisories/new)

报告中请尽量包含：

- 受影响的模块与版本（如 `autoace-cli@1.0.1`）
- 复现步骤或概念验证（PoC）
- 潜在影响评估

我们会在 **7 天内**确认收到报告，并在确认问题后尽快发布修复与公告。

> **Please do not report security vulnerabilities in public GitHub Issues.**
> Use [GitHub private security advisories](https://github.com/kuaiyou-app/kuaiyou-open-source/security/advisories/new) instead. We acknowledge reports within 7 days.

## 支持的版本 (Supported Versions)

| 模块 | 版本 | 支持状态 |
| --- | --- | --- |
| `autoace-cli` | 1.x（最新发布） | ✅ 支持 |
| 技能库 (`skills/`) | — | 仅接受结构/内容问题报告 |
| 开源官网 | [`kuaiyou-website`](https://github.com/kuaiyou-app/kuaiyou-website) | 在对应仓库报告 |

## 范围说明 (Scope)

本仓库的安全边界主要包括：

- **MCP CLI（`autoace-cli/`，包名 `autoace-cli`）**：在本机以用户权限运行，通过局域网 HTTP 或 ADB 与 Android 设备通信。命令注入、路径穿越、不安全的临时文件处理等属于重点防护面。
- **技能 JSON（`skills/`）**：技能由用户自行审阅后导入手机执行。CLI 每次校验和推送都会使用当前 App 通过 `GET /api/mcp/schema` 提供的实时契约，端点不可用时不会回退到仓库副本；但**技能内容的语义安全性仍由使用者负责**——请勿导入来源不明的技能。

以下不在本仓库安全范围内：快游大师 Android 闭源客户端本身的问题（请通过应用内渠道反馈）、开源官网（见 `kuaiyou-website`）、用户本机环境（ADB、Node.js）的固有风险。
