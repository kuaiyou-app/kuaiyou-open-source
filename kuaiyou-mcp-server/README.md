# autoace-cli

快游大师电脑端 MCP CLI（npm 包名：`autoace-cli`）。让 Cursor / Claude 等 AI 客户端连接 Android 上的「快游大师」App，编写并推送**技能**。

- **npm**：https://www.npmjs.com/package/autoace-cli
- **源码**：https://github.com/kuaiyou-app/kuaiyou-open-source/tree/main/kuaiyou-mcp-server
- **官网**：https://kuaiyou-app.github.io/kuaiyou-website/

兼容旧命令名：`kuaiyou-mcp-server`（同一二进制）。

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
KUAIYOU_DEVICE_IP=192.168.1.100:3847 KUAIYOU_MCP_PAIRING_CODE=482917 npx -y autoace-cli
```

## License

Apache-2.0
