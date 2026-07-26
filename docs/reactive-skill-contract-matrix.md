# ReactiveSkill 契约交叉核对（App ↔ schema.json）

生成日期：2026-07-26。权威运行时：`GoalAction.kt`；对外契约：开源根目录 `schema.json`。

| Action / 概念 | App `@SerialName` | schema.json | 备注 |
|---------------|-------------------|-------------|------|
| tap / longTap / typeText / swipe / scrollTo | 有 | 有 | 对齐 |
| launchApp / systemAction / notify / delay | 有 | 有 | 对齐 |
| storeValue | 有 | 有 | 取代 readText/setClipboard |
| waitFor / assertion / conditionBranch / loop | 有 | 有 | 对齐 |
| runStep / captureScreenshot | 有 | 有 | 对齐 |
| readText / setClipboard | 仍可反序列化（Deprecated） | **不声明** | MCP/导入硬拒 |
| askAgent | Deprecated，validate 拒绝 | **不声明** | MCP/导入硬拒 |
| agentId | 内部字段 | 不在 required / 对外文档禁止 | sanitize 强制 `""` |

漂移修复策略：App 已有且 schema 缺 → 补 schema；schema 有且 App 无 → 从 schema 移除或标弃用。本轮以硬拒旧别名为准，未删 Kotlin 数据类以免炸存量本地库。
