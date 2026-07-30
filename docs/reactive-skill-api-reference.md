# 技能契约获取与校验

技能 JSON 的唯一权威契约由当前连接的快游大师 App 客户端维护。开启 MCP 服务后，客户端通过 `GET /api/mcp/schema` 提供实时 JSON Schema；仓库、CLI 源码和 npm 包均不保存长期副本。

## MCP 工作流

1. 调用 `get_kuaiyou_schema` 获取当前客户端契约，再据此生成技能 JSON。
2. 调用 `validate_kuaiyou_skill`。CLI 会重新请求 `GET /api/mcp/schema`，使用本次响应编译校验器并返回字段级错误。
3. 调用 `push_reactive_skill`。CLI 会再次获取客户端契约；只有实时契约校验及附加安全检查通过后，才会请求 `POST /api/mcp/import`。
4. 手机端显示导入确认框，用户确认后技能才会落盘。

每次校验和推送都重新访问客户端。CLI 仅在端点和响应文本完全相同时复用已编译校验器，不会跳过网络请求，也不会在客户端不可用时回退到本地契约。

## 直接访问端点

非 MCP 调试场景可直接请求客户端：

```bash
curl "http://<DEVICE_IP>:<PORT>/api/mcp/schema" \
  -H "Authorization: Bearer <PAIRING_CODE>"
```

地址、端口和配对码以 App 当前复制的 MCP 配置为准。配对码会在 MCP 服务重启后变化，禁止写入仓库、文档示例的真实值或日志。

## 失败策略

- 未配置设备地址：提示设置 `KUAIYOU_DEVICE_URL`，或设置 App 显示的 `KUAIYOU_DEVICE_IP`。
- 端点不可达、鉴权失败、返回非 JSON、返回内容不是可编译的 JSON Schema：校验与推送失败，不使用缓存或仓库文件兜底。
- Schema 响应变化：立即编译并使用新契约，旧校验器失效。

## 仓库边界

- 示例技能仅用于演示，不构成字段、枚举、默认值或兼容性承诺。
- `scripts/validate-skills.mjs` 只进行离线 JSON、引用和业务规则检查，不能替代客户端契约校验。
- 不应新增 Schema 镜像、Schema 生成脚本、枚举对照表或依赖本地契约的 CI 检查。
- 编写字段、动作、触发器或选择器时，始终以当次 `get_kuaiyou_schema` 返回内容为准。
