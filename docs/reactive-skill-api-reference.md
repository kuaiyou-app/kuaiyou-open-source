# ReactiveSkill API 协议参考手册（Schema v2）

`ReactiveSkill` 是快游大师的反应式自动化描述协议。权威契约是仓库根目录的手写 [`schema.json`](../schema.json)，与 App 端 `GoalAction` / `ReactiveSkill` 模型对齐；MCP 的 Zod 校验是该契约的投影。

> 本文档仅描述 **v2** 词表。旧文档中的 `ClickAction`、`TextTargetSelector`、`AllGoalsComplete`、`Timeout`+`timeoutMs`、`agentId` 等 **一律无效**。

## 1. JSON 结构总览

```json
{
  "id": "skill_unique_id",
  "name": "每日签到",
  "description": "自动打开任务页并点击签到",
  "executionMode": "REACTIVE",
  "launchApp": {
    "type": "launchApp",
    "packageName": "com.example.app"
  },
  "termination": { "type": "allGoalsDone" },
  "goals": []
}
```

### 关键字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` / `name` / `description` | 是 | 元数据 |
| `goals` | 是 | 至少一个 Goal |
| `termination` | 否 | 默认等价 `allGoalsDone`；无限监听请用 `timeout` / `idleTimeout` / `manual` |
| `launchApp` | 否 | 全局启动应用，等价一个 `launchApp` 动作 |
| `interrupts` | 否 | 全局弹窗拦截（`when` + `dismiss`） |
| `agentId` | **禁止下发** | MCP 导入会删除；勿写入对外技能 |

### 禁止的动作类型

以下类型会被 MCP / App 导入门禁 **硬拒绝**（不要写进技能）：

- `askAgent` — 非端上可执行
- `readText` — 已移除，改用 `storeValue` + `source.type=screen`
- `setClipboard` — 已移除，改用 `storeValue` + `source.type=template` + `copyToClipboard: true`

---

## 2. Goal

```json
{
  "id": "step_1",
  "name": "点击签到按钮",
  "trigger": { "type": "immediate" },
  "action": {
    "type": "tap",
    "target": { "type": "text", "text": "签到领金币", "exact": true }
  },
  "constraints": {
    "maxExecutions": 1,
    "cooldownMs": 0,
    "continueOnFailure": false,
    "enabled": true
  }
}
```

- 非 `immediate` 触发的 Goal **必须**带 `action` 或 `actions`
- `afterGoal.goalId` / `runStep.goalId` 必须引用已存在的 goal `id`，且不能成环
- `constraints` 各字段可选（缺省见 `schema.json` 默认值）

### 常用 trigger.type

`immediate` · `elementVisible` · `elementGone` · `appInForeground` · `afterGoal` · `delayedAfterGoal` · `anyOf` · `allOf`

### 常用 target.type

`text`（+ 可选 `exact`）· `desc` · `id`（`viewId`）· `semantic` · `pos`（脆弱，尽量少用）· `image` · `composite`

---

## 3. 动作（GoalAction）

判别字段一律为小写 camelCase 的 `type`。

| type | 要点 |
|------|------|
| `tap` / `longTap` | 需要 `target` |
| `typeText` | `text` + `target`；粘贴用 `mode: "PASTE"` |
| `swipe` | 全屏百分比或相对 `target` 锚点 |
| `scrollTo` | `target` + `direction` |
| `launchApp` | `packageName` |
| `systemAction` | `systemType`: `BACK` / `HOME` / … |
| `storeValue` | 见下节 |
| `notify` | `message` |
| `delay` | `durationMs` |
| `waitFor` / `assertion` | `condition` |
| `conditionBranch` | `condition` + `onTrue` / `onFalse` |
| `loop` / `runStep` / `captureScreenshot` | 见 `schema.json` |

### storeValue（读写变量 / 剪贴板）

读取屏幕：

```json
{
  "type": "storeValue",
  "source": { "type": "screen", "target": { "type": "id", "viewId": "com.app:id/title" } },
  "variableName": "title"
}
```

写入剪贴板：

```json
{
  "type": "storeValue",
  "source": { "type": "template", "text": "要复制的文本 {{title}}" },
  "copyToClipboard": true
}
```

---

## 4. termination.type

| type | 说明 |
|------|------|
| `allGoalsDone` | 所有目标完成后结束（默认） |
| `anyGoalDone` | 任一目标完成 |
| `manual` | 手动停止 |
| `timeout` | 需要 `maxDurationMs` |
| `idleTimeout` | 需要 `maxIdleMs` |

---

## 5. 校验与部署

1. 用 MCP `validate_kuaiyou_skill`（或 CI `scripts/validate-skills.mjs`）校验
2. `push_reactive_skill` **会先跑同一套校验**，失败则拒绝部署
3. 局域网部署需配置 `KUAIYOU_MCP_PAIRING_CODE`（App 设置里复制的 6 位配对码；兼容旧名 `KUAIYOU_MCP_TOKEN`），请求带 `Authorization: Bearer <code>`
4. ADB 兜底路径：`/sdcard/Download/kuaiyou/<skillId>.json` + deep link

常见坑：

1. **悬空引用**：`afterGoal` / `runStep` 指向不存在的 `goalId`
2. **V1 词表**：`ClickAction` / `AllGoalsComplete` / `Timeout` 会被拒绝或警告
3. **坐标脆弱性**：优先 `text` / `id` / `semantic`，少用 `pos`
4. **无限 REPEAT**：`executionMode: REPEAT` + `maxExecutions: 0` 且无 `timeout` termination 时校验器会警告可能永不停止
