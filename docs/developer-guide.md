# 技能编写与联调手册 (Developer Guide)

欢迎来到快游大师的开发者指南！本文将带您了解如何基于 V2 `ReactiveSkill` 架构，使用 AI 助理编写并联调 Android 端侧自动化脚本。

## 1. 核心架构：ReactiveSkill V2

在 V2 版本中，我们的架构理念是 **响应式 (Reactive)** 与 **完全本地化 (Local-first)**。这意味着脚本不再是按照固定顺序“死等”执行的流水线，而是由一系列独立的 `Goal`（目标）和 `Interrupt`（中断处理）构成的状态机。

### 1.1 移除的废弃字段与动作
- **`agentId`**：在 V2 的 `schema.json` 中已全面剔除，您生成的 JSON 不再需要携带此字段。
- **`readText` / `setClipboard`**：已移除；请使用 `storeValue`（`source.type=screen|template`）。
- **校验**：以手写 [`schema.json`](../schema.json) 与 MCP Zod/lint 为准，详见 [reactive-skill-api-reference.md](./reactive-skill-api-reference.md)。
- **`askAgent`**：执行期挂起外联大模型的动作已被双端严格拦截。所有的控制逻辑均需在本地（通过 `tap`, `swipe`, `launchApp`, `delay` 等动作）完成闭环，以保障执行性能与数据安全。

## 2. 编写规范的脚本 (基于 Schema)

我们推荐您将本仓库的 `schema.json` 挂载到您的 Cursor/IDE 中，利用 JSON Schema 进行代码补全。下面是一些关键的机制与技巧：

### 2.1 目标 (Goal) 与 触发器 (Trigger)
脚本的核心是 `goals` 数组。每个目标都有一个触发条件 `trigger`：
- `{"type": "immediate"}`：脚本启动时立刻触发，或只要满足条件就一直尝试。
- `{"type": "afterGoal", "goalId": "xxx"}`：在前一个目标完成（或成功执行一次）后触发。

### 2.2 循环控制：`cooldownMs` 机制
在需要无限循环执行某个动作（如“无限上滑刷视频”）时，**不要使用**传统的代码循环结构，而是利用 `Goal` 本身的执行与冷却机制：
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
无需死磕绝对坐标，您可以使用 `semantic` 选择器精准点击或滑动：
- **语义点击**：直接描述目标，如 `{"type": "semantic", "description": "红色的点赞按钮"}`，底层会结合无障碍树自动寻找。
- **相对滑动**：在特定面板内滑动，只需在 `swipe` 的 `target` 中指定该面板，`startXPct` 等百分比坐标将基于该面板的尺寸进行计算。

### 2.4 全局拦截器 (Interrupts)
网络卡顿或突发的青少年模式弹窗常导致脚本失败。在 `interrupts` 数组中声明拦截器即可：
```json
{
  "name": "青少年模式弹窗",
  "when": { "type": "semantic", "description": "青少年模式弹窗提醒" },
  "dismiss": { "type": "semantic", "description": "我知道了按钮或关闭弹窗的叉号" },
  "priority": 10
}
```
系统会开启独立的高优先级线程进行轮询监控。

## 3. 开发与联调避坑指南

1. **🚫 严禁使用 `askAgent`**
   如果您的脚本中包含了 `askAgent` 类型的 `action`，在推送给手机时，不仅无法运行，还会被网关直接拦截并抛出错误。V2 端侧引擎只接受本地动作指令。

2. **🚫 避免硬编码设备分辨率**
   请尽可能使用 `semantic`，或者在 `swipe` 中使用 `startXPct`、`startYPct` 等百分比坐标，以确保脚本在不同手机上都能完美兼容。

3. **✅ 合理分配 `priority`**
   当多个 `Interrupt` 同时满足条件时，`priority` 越高的越先被处理（例如版本更新提示可能覆盖了青少年模式弹窗）。

## 4. 实战参考
请前往根目录下的 `examples/` 目录查看我们提供的最佳实践范例。
