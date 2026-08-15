# 社区技能目录

这里是可导入快游大师的技能 JSON（不是 Cursor Agent Skill）。

适合提交：**每日签到、打开指定页并等待、关闭更新弹窗** 等可复用的重复劳动。

不要放进本目录：引擎回归用例、`test_*` 命名、过期热榜文案、无限刷视频。那些放在 `autoace-cli/fixtures/device/`。

提交前用当前 App 的 `get_kuaiyou_schema` + `validate_kuaiyou_skill` 校验，并按 [CONTRIBUTING.md](../CONTRIBUTING.md) 附上 App 版本与真机演示。`index.json` 由 `node scripts/build-skill-index.js` 生成，请勿手改条目列表。
