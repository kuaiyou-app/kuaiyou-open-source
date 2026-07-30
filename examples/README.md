# 技能示例

技能 JSON 示例，仅用于说明常见用法，不构成字段、枚举或默认值定义。使用前应通过 `get_kuaiyou_schema` 获取当前 App 的实时契约，再调用 `validate_kuaiyou_skill` 校验并推送。

## 示例索引

1. **[01_自动刷视频.json](./01_自动刷视频.json)**  
   演示用 `constraints.cooldownMs` 与 `executionMode: "REPEAT"` 做安全循环上滑。

2. **[02_智能抖音V2.json](./02_智能抖音V2.json)**  
   - **Interrupts**：拦截青少年模式、版本更新等弹窗  
   - **Semantic**：语义定位按钮  
   - **相对滑动**：在指定列表控件内局部百分比滑动  

## 如何运行

启动 **autoace-cli** 并连接设备后，让 AI 读取这些技能 JSON 并推送到手机，或自行改写后导入。
