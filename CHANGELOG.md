# Changelog

本仓库按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 记录面向用户的变更。`autoace-cli` 的 npm 版本见 `autoace-cli/package.json`。

## Unreleased

### Added

- MCP 工具 `observe_screen`：一次返回截屏 + 可交互节点摘要（文案 / id / bounds / centerPct）和当前包名。写选择器时优先用它，而不是完整 `get_ui_tree`。

### Fixed

- `push_reactive_skill` 现在与 `validate_kuaiyou_skill` 一样接受 `.json` 文件路径；此前 validate 能过、push 会把路径当 JSON 正文拒绝。
- 文档与代码对齐：去掉已删除的 ADB 通道表述；贡献指南 clone URL 改为 `kuaiyou-open-source`；Node 基线改为 ≥20（CI 20/22）。
- 示例 `02_智能抖音V2.json` 描述不再提及已移除的「向外求助」。
