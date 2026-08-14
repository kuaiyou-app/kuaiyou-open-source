---
name: Skill JSON Submission (提交自动化技能)
about: Share an AI-generated skill validated against the current App contract. (分享通过当前客户端契约校验的技能)
title: '[SKILL] '
labels: skill
assignees: ''
---

**Skill Name (技能名称)**
What does this skill do? (这个技能是做什么的？比如：自动清理微信缓存)

**Pain Point Solved (解决了什么痛点)**
Why did you create this skill? (为什么要创建这个技能？解决了什么重复劳动问题？)

**Target App & Version (适用App及版本)**
- App Name (App名称): [e.g. 微信]
- App Version (App版本): [e.g. 8.0.40] (Important for verifying node compatibility / 节点兼容性验证)
- Kuaiyou App Version (快游大师版本):
- Phone Resolution/Density (手机分辨率/DPI, if known): [e.g. 1080x2400]

**The JSON Script (技能 JSON 内容)**
Please paste the complete skill JSON here (or link to a Gist). Do not paste or commit a Schema copy. Engine regression / `test_*` / infinite swipe skills belong in `autoace-cli/fixtures/device/`, not the public `skills/` catalog. (请粘贴完整技能 JSON；不要附带或提交 Schema 副本。引擎测试与无限刷视频不要提交到社区目录。)

```json
PASTE THE SKILL JSON VALIDATED BY THE CURRENT APP HERE
```

**Contract Validation (契约校验)**
- [ ] I called `get_kuaiyou_schema` against the App version above.
- [ ] The JSON passed `validate_kuaiyou_skill` before submission.

**Demo (效果演示)**
Please provide a link to a GIF or Video showing the script running on your phone. (请提供一个展示脚本运行效果的动图或视频链接。)
[Link to Demo / 演示链接]

**Additional notes (其他备注)**
Any specific initial state required before running this skill? (运行前有什么前置条件吗？比如：需要停留在App首页。)
