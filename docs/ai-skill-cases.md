# 快游大师技能库：AI 生成自动化案例

自快游大师 `autoace-cli` 推出以来，广大开发者和极客玩家使用 Cursor 和 Claude 等大模型，创造了成百上千个有趣的自动化场景。

这里挑选了两个经典的“**由大模型一键生成**”的开源案例，希望能为您带来灵感！想要分享您的神仙技能？欢迎查阅我们的 [贡献指南](../CONTRIBUTING.md) 提交 PR！

---

## 案例一：自动签到与领积分 🎁

**场景痛点**：每天打开好几个 App 点签到领积分，枯燥且费时。
**AI 生成思路**：通过 `get_ui_tree` 扫描屏幕，找到文本包含“签到”、“领金币”、“马上领取”的节点并逐个触发点击。

### 技能 JSON 结构片段
```json
{
  "id": "auto-sign-in-daily",
  "name": "每日自动签到领积分",
  "description": "自动寻找并点击签到和领取按钮，支持大部分 App 的日常任务",
  "executionMode": "REACTIVE",
  "agentId": "",
  "termination": { "type": "AllGoalsComplete" },
  "goals": [
    {
      "id": "click-sign-in",
      "name": "点击签到",
      "action": {
        "type": "ClickAction",
        "target": {
          "type": "TextTargetSelector",
          "text": "签到",
          "exactMatch": false
        }
      }
    },
    {
      "id": "click-reward",
      "name": "领取奖励",
      "action": {
        "type": "ClickAction",
        "target": {
          "type": "TextTargetSelector",
          "text": "领金币",
          "exactMatch": false
        }
      }
    }
  ]
}
```
**为什么它好用？**：AI 选择了 `exactMatch: false`，这意味着不论按钮上写的是“点击签到”还是“去签到”，都能被精准捕捉。您只需要设定每天早上 8 执行，它就会在后台默默完成所有工作。

---

## 案例二：智能答题辅助 🧠

**场景痛点**：在某些 App 的答题活动中，题目往往千奇百怪，来不及百度搜索。
**AI 生成思路**：
1. 大模型利用 MCP 截图 (`capture_screenshot`) 读取当前的考题内容。
2. 大模型在后台直接推理出正确答案。
3. 大模型热重载写入包含确切文本（即正确答案）的 `TextTargetSelector`。
4. 快游大师引擎瞬间自动点击正确的选项。

### 技能 JSON 结构片段
```json
{
  "id": "auto-quiz-solver",
  "name": "智能答题点击",
  "description": "接收 AI 下发的正确答案文本并自动寻找选项点击",
  "executionMode": "REACTIVE",
  "agentId": "",
  "termination": { "type": "AllGoalsComplete" },
  "goals": [
    {
      "id": "click-correct-answer",
      "name": "点击正确选项",
      "action": {
        "type": "ClickAction",
        "target": {
          "type": "TextTargetSelector",
          "text": "李白", 
          "exactMatch": true
        }
      }
    }
  ]
}
```
**为什么它好用？**：这展现了快游大师**高度动态化**的魅力。技能不是一成不变的，它可以是 AI 分析后的临时产物（上文中的 `text: "李白"` 就是大模型推断出的答案），通过 `push_reactive_skill` 瞬间下发并点击，实现了“端云协同”的无缝闭环！

---

快来加入我们的开源共建计划，将你用大模型捏出的“神仙 JSON”提交到 GitHub 仓库吧！
