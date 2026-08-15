# 技能示例

技能 JSON 示例，仅用于说明常见用法，不构成字段、枚举或默认值定义。使用前应通过 `get_kuaiyou_schema` 获取当前 App 的实时契约，再调用 `validate_kuaiyou_skill` 校验并推送。

## 示例索引

1. **[01_打开应用并等待.json](./01_打开应用并等待.json)**  
   演示 `launchApp` 之后用 `elementVisible` 等待首页文案出现。把包名和文案换成你的应用即可。

2. **[02_拦截弹窗并签到.json](./02_拦截弹窗并签到.json)**  
   - **Interrupts**：拦截版本更新等打断主流程的弹窗  
   - **文案点击**：屏幕出现「签到」时点击一次后结束，不用无限循环  

可导入的社区技能见 [`skills/`](../skills/)；引擎回归夹具在 `autoace-cli/fixtures/device/`，不要当示范抄。

## 如何运行

启动 **autoace-cli** 并连接设备后，让 AI 读取这些技能 JSON 并推送到手机，或自行改写后导入。写选择器前优先调用 `observe_screen`。
