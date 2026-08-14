#!/bin/bash
# reactive_skill_test.sh — 反应式技能实机验证脚本
#
# 工作流：
#   1. 先启动快游大师 App，确保进程和无障碍服务就绪
#   2. 将技能 JSON 以 base64 内联方式发送给 ReactiveSkillCommandReceiver
#   3. 由 receiver 转发到 AccessibilitySkillService
#   4. 优先从设备诊断文件 reactive_diag.log 判断执行结果，必要时回退到 logcat
#
# 用法：
#   ./reactive_skill_test.sh start <json_file>   # 从文件启动技能
#   ./reactive_skill_test.sh start-wait <json_file> # 启动并等待完成结果
#   ./reactive_skill_test.sh stop                 # 停止当前技能
#   ./reactive_skill_test.sh log                  # 查看实时日志
#   ./reactive_skill_test.sh diag                 # 查看设备端诊断日志
#   ./reactive_skill_test.sh help                 # 查看完整说明
#
# 前提：
#   - 手机已连接
#   - 快游大师无障碍服务已开启并已绑定
#   - 目标 App 已加入自动调用白名单
#   - 已安装包含 ReactiveSkillCommandReceiver 与 base64 JSON 支持的最新包

# ===== 自动探测 adb 路径 =====
ADB=""
for candidate in \
    "$HOME/Library/Android/sdk/platform-tools/adb" \
    "/usr/local/bin/adb" \
    "/opt/homebrew/bin/adb" \
    "$(which adb 2>/dev/null)"; do
    if [ -x "$candidate" ]; then
        ADB="$candidate"
        break
    fi
done
if [ -z "$ADB" ]; then
    echo "错误：找不到 adb，请确认 SDK 已安装或将 adb 加入 PATH"
    exit 1
fi

# ===== 自动选择设备 =====
DEVICE_COUNT=$("$ADB" devices | grep -v "^List" | grep -v "^$" | wc -l | tr -d ' ')
if [ "$DEVICE_COUNT" -eq 0 ]; then
    echo "错误：未找到已连接设备"
    "$ADB" devices
    exit 1
fi

# 自动取第一个设备
DEVICE_ID=$("$ADB" devices | grep -v "^List" | grep -v "^$" | head -1 | awk '{print $1}')
echo "→ 使用设备: $DEVICE_ID"

# ===== 常量 =====
# 自动探测已安装的快游大师包名（debug 包带 .test 后缀）
# Vivo XSpace/多用户设备上需指定 --user 0，否则可能报 "Shell does not have permission to access user 666"
PACKAGE=$("$ADB" -s "$DEVICE_ID" shell pm list packages --user 0 com.kuaiyou.automator.clicker 2>/dev/null | head -n 1 | sed 's/package://')
if [ -z "$PACKAGE" ]; then
    echo "错误：未找到已安装的快游大师包（com.kuaiyou.automator.clicker 或 com.kuaiyou.automator.clicker.test）"
    exit 1
fi
echo "→ 目标包名: $PACKAGE"
ACCESSIBILITY_SERVICE_COMPONENT="${PACKAGE}/com.kuaiyou.automator.clicker.service.AccessibilitySkillService"
REACTIVE_RECEIVER_COMPONENT="${PACKAGE}/.service.ReactiveSkillCommandReceiver"
# action 保持与 AndroidManifest.xml 中声明的一致，不随 debug 包名变化
ACTION_START="com.kuaiyou.automator.clicker.action.EXECUTE_REACTIVE_SKILL"
ACTION_STOP="com.kuaiyou.automator.clicker.action.STOP_REACTIVE_SKILL"
LOG_TAGS=("LX_REACTIVE_RUNNER:V" "LX_REACTIVE_EXEC:V" "LX_REACTIVE_SENSOR:V" "LX_AUTOMATION:V" "LX_GESTURE:V")
DIAG_FILE="/sdcard/Android/data/${PACKAGE}/files/reactive_diag.log"

generate_execution_id() {
    echo "reactive_adb_$(date +%s)_$$"
}

clear_reactive_logs() {
    "$ADB" -s "$DEVICE_ID" logcat -c >/dev/null 2>&1 || true
}

launch_app() {
    echo "→ 先启动 App ..."
    "$ADB" -s "$DEVICE_ID" shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null
    sleep 2
}

start_skill() {
    local json_file="$1"
    local execution_id="$2"
    local json_payload_b64
    json_payload_b64="$(base64 < "$json_file" | tr -d '\n')"

    local service_status
    service_status=$("$ADB" -s "$DEVICE_ID" shell settings get secure enabled_accessibility_services 2>/dev/null | grep -c "$ACCESSIBILITY_SERVICE_COMPONENT")
    if [ "$service_status" -eq 0 ]; then
        echo "✗ 未检测到无障碍服务已开启，无法执行 reactive skill 广播链路"
        return 1
    fi

    launch_app

    echo "→ 使用 executionId: $execution_id"
    echo "→ 显式发送执行广播到 ReactiveSkillCommandReceiver（base64 JSON）..."
    "$ADB" -s "$DEVICE_ID" shell am broadcast \
        -n "$REACTIVE_RECEIVER_COMPONENT" \
        -a "$ACTION_START" \
        --es "extra_reactive_skill_json_b64" "$json_payload_b64" \
        --es "extra_execution_id" "$execution_id" >/dev/null
}

wait_for_completion() {
    local execution_id="$1"
    local timeout_sec="${2:-120}"
    local deadline=$(( $(date +%s) + timeout_sec ))

    while [ "$(date +%s)" -lt "$deadline" ]; do
        local diag
        diag=$("$ADB" -s "$DEVICE_ID" shell cat "$DIAG_FILE" 2>/dev/null | grep "$execution_id" || true)
        if echo "$diag" | grep -q "stage=reactive.handle.complete"; then
            if echo "$diag" | grep -q "success=true"; then
                echo "✓ 技能执行完成：success=true"
                echo "$diag" | tail -n 30
                return 0
            fi
            echo "✗ 技能执行完成：success=false"
            echo "$diag" | tail -n 40
            return 1
        fi
        local logs
        logs=$("$ADB" -s "$DEVICE_ID" logcat -d -v time "${LOG_TAGS[@]}" | grep "$execution_id" || true)
        if echo "$logs" | grep -q "service.notifyComplete"; then
            if echo "$logs" | grep -q "success=true"; then
                echo "✓ 技能执行完成：success=true"
                return 0
            fi
            echo "✗ 技能执行完成：success=false"
            echo "$logs" | tail -n 20
            return 1
        fi
        sleep 1
    done

    echo "✗ 等待超时，最近日志："
    "$ADB" -s "$DEVICE_ID" shell cat "$DIAG_FILE" 2>/dev/null | grep "$execution_id" | tail -n 40 || true
    "$ADB" -s "$DEVICE_ID" logcat -d -v time "${LOG_TAGS[@]}" | grep "$execution_id" | tail -n 40 || true
    return 1
}

case "$1" in
  start)
    if [ -z "$2" ]; then
        echo "用法: $0 start <json_file>"
        exit 1
    fi
    JSON_FILE="$2"
    if [ ! -f "$JSON_FILE" ]; then
        echo "文件不存在: $JSON_FILE"
        exit 1
    fi

    EXECUTION_ID=$(generate_execution_id)
    clear_reactive_logs
    start_skill "$JSON_FILE" "$EXECUTION_ID"
    if [ $? -eq 0 ]; then
        echo "✓ 广播已发送，查看执行日志: $0 log"
    else
        echo "✗ 广播发送失败"
    fi
    ;;

  start-wait)
    if [ -z "$2" ]; then
        echo "用法: $0 start-wait <json_file> [timeout_sec]"
        exit 1
    fi
    JSON_FILE="$2"
    WAIT_TIMEOUT="${3:-120}"
    if [ ! -f "$JSON_FILE" ]; then
        echo "文件不存在: $JSON_FILE"
        exit 1
    fi
    EXECUTION_ID=$(generate_execution_id)
    clear_reactive_logs
    start_skill "$JSON_FILE" "$EXECUTION_ID" || exit 1
    wait_for_completion "$EXECUTION_ID" "$WAIT_TIMEOUT"
    ;;

  stop)
    echo "→ 发送停止广播..."
    "$ADB" -s "$DEVICE_ID" shell am broadcast \
        -a "$ACTION_STOP" \
        -p "$PACKAGE"
    echo "✓ 停止广播已发送"
    ;;

  log)
    echo "→ 实时日志 (Ctrl+C 退出):"
    "$ADB" -s "$DEVICE_ID" logcat -v time -s "${LOG_TAGS[@]}"
    ;;

  diag)
    echo "→ 设备诊断日志：$DIAG_FILE"
    "$ADB" -s "$DEVICE_ID" shell cat "$DIAG_FILE" 2>/dev/null || echo "暂无诊断日志"
    ;;

  devices)
    echo "已连接设备："
    "$ADB" devices
    ;;

  json)
    if [ -z "$2" ]; then
        echo "用法: $0 json '<json_string>'"
        exit 1
    fi
    echo "→ 发送 JSON 内联广播..."
    "$ADB" -s "$DEVICE_ID" shell am broadcast \
        -a "$ACTION_START" \
        -p "$PACKAGE" \
        --es "extra_reactive_skill_json" "$2"
    if [ $? -eq 0 ]; then
        echo "✓ 广播已发送，查看执行日志: $0 log"
    else
        echo "✗ 广播发送失败"
    fi
    ;;

  help|-h|--help)
    echo "用法："
    echo "  $0 start <json_file>"
    echo "    启动一次技能，不等待完成。"
    echo
    echo "  $0 start-wait <json_file>"
    echo "    推荐回归入口。脚本会先启动 App，再显式广播到 ReactiveSkillCommandReceiver，"
    echo "    并通过设备端 reactive_diag.log 判断 success/failure。"
    echo
    echo "  $0 stop"
    echo "    停止当前 reactive skill。"
    echo
    echo "  $0 log"
    echo "    查看 LX_REACTIVE_* / LX_AUTOMATION / LX_GESTURE 实时日志。"
    echo
    echo "  $0 diag"
    echo "    查看设备端诊断文件：$DIAG_FILE"
    echo
    echo "  $0 devices"
    echo "    列出已连接设备。"
    echo
    echo "  $0 json '<json_string>'"
    echo "    兼容模式：直接发送原始 JSON 字符串，不建议日常回归使用。"
    echo
    echo "推荐示例："
    echo "  $0 start-wait android/docs/reactive_skill_samples/test_toutiao.json"
    echo "  $0 diag | tail -n 40"
    ;;

  *)
    echo "未知命令: $1"
    echo "使用 '$0 help' 查看说明"
    exit 1
    ;;
esac
