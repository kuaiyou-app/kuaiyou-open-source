# Changelog

本仓库按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 记录面向用户的变更。`autoace-cli` 的 npm 版本见 `autoace-cli/package.json`。

## Unreleased

### Added

- MCP 工具 `observe_screen`：一次返回截屏 + 可交互节点摘要（文案 / id / bounds / centerPct）和当前包名。写选择器时优先用它，而不是完整 `get_ui_tree`。
- `pair_device` 成功后把地址与配对码写入本机 `~/.config/autoace/device.json`（可用 `KUAIYOU_CONFIG_DIR` 覆盖）。冷启动优先用这份记录，不必为换地址改 mcp.json。
- `push_reactive_skill` 可选 `run: true`、`run_skill` 可选 `wait: true`：等到技能结束或失败后返回 log 摘要；失败/超时附带截屏。仍须手机确认，CLI 不会跳过 App 确认框。

### Changed

- 社区技能目录去测试化：`skills/` 改为打开微信/支付宝、关弹窗、文案签到；头条回归 JSON 与抖音无限上滑移到 `autoace-cli/fixtures/device/`。`examples/` 同步改为打开应用与拦截弹窗并签到。

### Fixed

- `push_reactive_skill` 现在与 `validate_kuaiyou_skill` 一样接受 `.json` 文件路径；此前 validate 能过、push 会把路径当 JSON 正文拒绝。
- 文档与代码对齐：去掉已删除的 ADB 通道表述；贡献指南 clone URL 改为 `kuaiyou-open-source`；Node 基线改为 ≥20（CI 20/22）。
