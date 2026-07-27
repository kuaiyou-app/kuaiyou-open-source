# 技能编写与联调手册

如何用 AI 编写并联调 Android 端侧**技能**（契约见 [`schema.json`](../schema.json)）。

## 1. 执行模型

技能由 `Goal`（目标）与 `Interrupt`（中断处理）组成：按屏幕状态驱动，而不是固定流水线。

### 1.1 不要再使用的字段与动作
- **`agentId`**：已剔除，生成的 JSON 不要带此字段。
- **`readText` / `setClipboard`**：已移除；请用 `storeValue`（`source.type=screen|template`）。
- **校验**：以 [`schema.json`](../schema.json) 与 MCP Zod/lint 为准，详见 [reactive-skill-api-reference.md](./reactive-skill-api-reference.md)。
- **`askAgent`**：执行期外联大模型已拦截；逻辑请用本地动作（`tap` / `swipe` / `launchApp` / `delay` 等）闭环。

## 2. 编写规范（基于 Schema）

建议将 `schema.json` 挂到 IDE，用 JSON Schema 补全。

### 2.1 目标 (Goal) 与 触发器 (Trigger)
核心是 `goals` 数组。每个目标有触发条件 `trigger`：
- `{"type": "immediate"}`：启动时立刻触发，或条件满足时尝试。
- `{"type": "afterGoal", "goalId": "xxx"}`：前一个目标完成后再触发。

### 2.2 循环控制：`cooldownMs`
无限循环（如「无限上滑刷视频」）不要用代码循环，用 `Goal` 的执行与冷却：
```json
{
  "id": "swipe_up_loop",
  "name": "无限上滑浏览视频",
  "trigger": { "type": "immediate" },
  "action": {
    "type": "swipe",
    "startXPct": 0.5,
    "startYPct": 0.8,
    "endXPct": 0.5,
    "endYPct": 0.2,
    "durationMs": 300
  },
  "constraints": {
    "maxExecutions": 0,          // 0 表示无限次执行
    "cooldownMs": 8000,          // 每次执行后冷却 8000 毫秒（即停留 8 秒）
    "executionMode": "REPEAT"    // 循环模式
  }
}
```

### 2.3 语义点击与相对滑动
- **语义点击**：如 `{"type": "semantic", "description": "红色的点赞按钮"}`。
- **相对滑动**：在 `swipe.target` 指定面板后，`startXPct` 等百分比相对该面板计算。

### 2.4 全局拦截器 (Interrupts)
弹窗打断主流程时，在 `interrupts` 中声明拦截器：
```json
{
  "name": "青少年模式弹窗",
  "when": { "type": "semantic", "description": "青少年模式弹窗提醒" },
  "dismiss": { "type": "semantic", "description": "我知道了按钮或关闭弹窗的叉号" },
  "priority": 10
}
```

## 3. 避坑

1. **不要用 `askAgent`**：会被拦截；只使用本地动作。
2. **少用绝对分辨率**：优先 `semantic` 或百分比坐标。
3. **`priority`**：多个 Interrupt 同时命中时，数值更高的先处理。

## 4. 示例

见 `examples/`。
