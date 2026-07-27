# autoace-cli

快游大师电脑端 MCP CLI（npm 包名：`autoace-cli`）。让 Claude Code / Codex / Cursor 等连接 Android 上的「快游大师」App，编写并推送**技能**。

配套 Agent Skill 名称：**`autoace`**（仓库路径 `agent-skills/autoace/`）。

- **npm**：https://www.npmjs.com/package/autoace-cli
- **源码**：https://github.com/kuaiyou-app/kuaiyou-open-source/tree/main/kuaiyou-mcp-server
- **官网文档**：https://kuaiyou-app.github.io/kuaiyou-website/docs/
- **接入教程**：https://github.com/kuaiyou-app/kuaiyou-open-source/blob/main/docs/mcp-ecosystem-tutorial.md

兼容旧命令名：`kuaiyou-mcp-server`（同一二进制）。

> 旧 npm 包 `kuaiyou-mcp-server` 已废弃，不再更新。请改用 `autoace-cli`；`kuaiyou-mcp-server` 命令本身仍随本包安装，无需改动现有 MCP 配置。

## 要求

- Node.js ≥ 18
- 手机已安装快游大师，并开启 **MCP 服务**
- 局域网模式：手机与电脑同一 Wi‑Fi；点击「MCP 服务」可复制连接信息

## 安装 / 运行

```bash
# 推荐：npx
npx -y autoace-cli

# 全局安装
npm install -g autoace-cli
autoace-cli
```

局域网示例：

```bash
# 端口与配对码每次开启 MCP 服务都会变，请照 App 当前显示的值填写
KUAIYOU_DEVICE_IP=192.168.1.100:41899 KUAIYOU_MCP_PAIRING_CODE=482917 npx -y autoace-cli
```

## License

Apache-2.0
