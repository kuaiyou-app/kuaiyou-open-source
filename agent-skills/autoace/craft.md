# autoace craft — 技能编写质量

配套主文件：[SKILL.md](SKILL.md)。写/改技能 JSON 时阅读。字段与动作类型以当次 `get_kuaiyou_schema` 为准；本文只谈策略。

## Principles

0. **规则认设备：** 生成规则以 `get_kuaiyou_prompts` 为准；字段以设备 schema 为准。忽略 prompts / schema 中的未知字段。本文只谈选择器策略与反模式，不是第二份动作表。禁止把 prompts 正文写入仓库。
1. **先契约后草稿**：未调用 `get_kuaiyou_schema` 前不编造动作名或选择器字段。
2. **先看屏再点**：优先 `observe_screen`（截屏 + 可交互节点）；无此工具再用 `get_ui_tree` / `capture_screenshot`。确认可交互节点后再写定位。
3. **稳定位优于坐标**：优先文本、contentDescription、resourceId、语义/相对定位；避免绝对像素坐标（分辨率一变即失效）。
4. **页面变了就重读**：目标 App 或快游升级后，重新拉 schema + UI，不要沿用旧 JSON 结构当真理。
5. **小步可验证**：先最短路径能跑通，再加分支；每次改完必须 `validate_kuaiyou_skill`。

## Selector preference (good → bad)

| 优先 | 做法 | 原因 |
| --- | --- | --- |
| 高 | 可见且稳定的文案 / contentDescription | 跨分辨率 |
| 高 | 稳定 resourceId（非动态生成） | 结构清晰 |
| 中 | 父子/兄弟相对关系 + 局部文本 | 缓解列表重复项 |
| 低 | 绝对坐标 / 固定百分比点击 | 易碎；仅无障碍树可用时兜底 |
| 禁 | 依赖一次 OCR/剪贴板类已移除动作 | `readText` / `setClipboard` / `askAgent` 等已删除 |

## Anti-patterns

- 把仓库 `examples/`、`skills/` 里的字段当当前契约。
- 未看 UI 树就写「点击屏幕中央」。
- 一次推送超长多 App 流程，失败后无法定位；应拆短技能或分阶段调试。
- 忽略 `validate` / lint 警告继续 push。
- 对用户称呼 ReactiveSkill；内部工具名除外。
- 将配对码或截图写入仓库「方便下次」。

## Debug loop (required when taps miss)

```text
observe_screen（无则 capture_screenshot / get_ui_tree）
  → 对照 get_execution_log / get_skill_status
  → 修正选择器或等待
  → validate_kuaiyou_skill
  → push_reactive_skill（等手机确认）
  → run_skill（若需主动跑）
  → 再看 log / observe_screen
```

点偏时优先怀疑：文案微变、列表多项同文案、弹层未关闭、动画未结束——用 UI 树证据改，不要只靠猜。

## Learning plans

- Schema **只**来自 `plans_schema`；404 则停止。
- `generatedBy` = 当前对话模型名（如 `Cursor Grok 4.5`），禁止 CLI/MCP/Skill 通道名。
- 部署前先 `plans_list`：配额满则先问删/覆盖/腾位，避免 validate 通过后撞 409。
- 同 id 部署会覆盖大纲**与**进度——改计划前必须强提醒并征得用户确认。
- 删除 `plans_delete` 无手机确认框——执行前向用户确认。
- 双推技能/计划时手机可能排队确认；无 queue API 前以手机弹窗为准。

## Related docs in repo

- 场景思路：`docs/ai-skill-cases.md`
- MCP 接入：`docs/mcp-ecosystem-tutorial.md`
- 这些文档是人读教程；运行时契约仍以设备为准。
