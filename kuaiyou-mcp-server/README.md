# kuaiyou-mcp-server

快游大师官方 MCP Server（npm 包）。让 Cursor / Claude 等 AI 客户端通过 MCP 连接 Android 上的「快游大师」App。

- **npm**：https://www.npmjs.com/package/kuaiyou-mcp-server
- **源码**：https://github.com/kuaiyou-app/kuaiyou-open-source/tree/main/kuaiyou-mcp-server
- **官网文档**：https://kuaiyou-app.github.io/kuaiyou-website/docs/

## 要求

- Node.js ≥ 18
- 手机已安装快游大师，并开启 **MCP 服务**（设置 → 高级设置）
- 局域网模式：手机与电脑同一 Wi‑Fi；点击「MCP 服务」可复制连接信息

## 快速使用

```bash
# 局域网（推荐）：IP:端口 + 6 位配对码
KUAIYOU_DEVICE_IP=192.168.1.100:3847 KUAIYOU_MCP_PAIRING_CODE=482917 npx -y kuaiyou-mcp-server

# USB / ADB 回退
KUAIYOU_ADB_SERIAL=<serial> npx -y kuaiyou-mcp-server
```

也可永久安装：

```bash
npm install -g kuaiyou-mcp-server
```

## Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "kuaiyou": {
      "command": "npx",
      "args": ["-y", "kuaiyou-mcp-server"],
      "env": {
        "KUAIYOU_DEVICE_IP": "192.168.1.100:3847",
        "KUAIYOU_MCP_PAIRING_CODE": "482917"
      }
    }
  }
}
```

`KUAIYOU_DEVICE_IP` 支持 `ip` 或 `ip:port`（未写端口时默认 `8080`）。配对码对应环境变量 `KUAIYOU_MCP_PAIRING_CODE`（兼容旧名 `KUAIYOU_MCP_TOKEN`）。

## License

Apache-2.0
