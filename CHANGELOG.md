# Changelog

本仓库按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 记录面向用户的变更。`autoace-cli` 的 npm 版本见 `autoace-cli/package.json`。

## Unreleased

### Fixed

- MCP stdout 不再混入非 JSON-RPC 内容：移除 dotenv（v17 启动时会向 stdout 打印提示行，并会读取客户端 cwd 下任意 `.env`，可能改写设备地址）。配置只来自 MCP 客户端 env 与 `pair_device` 本机记录。
- `push_reactive_skill` 仅在 HTTP 415 时回退表单提交；设备返回 400（技能被拒）时直接报告真实原因，不再二次提交掩盖错误。
- 单次网络抖动不再被判为断线：健康探测失败会重试一次后才要求重新配对。
- 移除钉死在易受攻击版本的 `overrides`（fast-uri / hono / ip-address），升级 `@modelcontextprotocol/sdk` 至 1.31，生产依赖 `npm audit` 清零。

### Changed

- `run_skill wait:true` / `push_reactive_skill run:true` 在客户端提供 progressToken 时发送 `notifications/progress` 保活；客户端取消请求后立即停止轮询（技能在手机上可能仍在运行）。
- `skillJson` / `planJson` 文件路径输入限制 1 MiB。
- 文档推荐 npx 启动时钉住主版本 `autoace-cli@1`。
- npm 发布改为 Trusted Publishing（OIDC）+ provenance，不再使用长期 `NPM_TOKEN`。

## [1.0.11] - 2026-08-15

### Added

- MCP 工具 `observe_screen`：一次返回截屏 + 可交互节点摘要（文案 / id / bounds / centerPct）和当前包名。写选择器时优先用它，而不是完整 `get_ui_tree`。
- `pair_device` 成功后把地址与配对码写入本机 `~/.config/autoace/device.json`（可用 `KUAIYOU_CONFIG_DIR` 覆盖）。冷启动优先用这份记录，不必为换地址改 mcp.json。
- `push_reactive_skill` 可选 `run: true`、`run_skill` 可选 `wait: true`：等到技能结束或失败后返回 log 摘要；失败/超时附带截屏。仍须手机确认，CLI 不会跳过 App 确认框。

### Changed

- 社区技能目录去测试化：`skills/` 改为打开微信/支付宝、关弹窗、文案签到；头条回归 JSON 与抖音无限上滑移到 `autoace-cli/fixtures/device/`。`examples/` 同步改为打开应用与拦截弹窗并签到。
- 配对成功后的能力清单改为默认自动化主路径（pair / observe / 校验推送 / 可选等到结束）；`plans_*` 仅在用户明确要求领域教练时再用。MCP 仍注册全部工具，不改名。

### Fixed

- `push_reactive_skill` 现在与 `validate_kuaiyou_skill` 一样接受 `.json` 文件路径；此前 validate 能过、push 会把路径当 JSON 正文拒绝。
- 文档与代码对齐：去掉已删除的 ADB 通道表述；贡献指南 clone URL 改为 `kuaiyou-open-source`；Node 基线改为 ≥20（CI 20/22）。
