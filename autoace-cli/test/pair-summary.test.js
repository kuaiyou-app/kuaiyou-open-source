const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePairAck,
  parseConnectionInfo,
  mergeConnectionInfo,
  formatConnectedDeviceContext,
  formatCliCapabilities,
  formatPairSuccessMessage,
} = require("../build/pair-summary.js");

const SAMPLE_PASTE = `快游大师局域网 MCP 已开启，请用开源 Skill / autoace-cli 连接。

地址：192.168.0.4:42091
配对码：541490

设备：Xiaomi · Android 14 · 1080x2400 · App 2.9.0

同网连接后先调用 pair 完成配对；配置变更后请重载 MCP。`;

test("parseConnectionInfo extracts address and device portrait from App paste", () => {
  const info = parseConnectionInfo(SAMPLE_PASTE);
  assert.equal(info.address, "192.168.0.4:42091");
  assert.equal(info.hasPairingCode, true);
  assert.equal(info.pairingCode, "541490");
  assert.equal(info.brand, "Xiaomi");
  assert.equal(info.androidVersion, "14");
  assert.equal(info.resolution, "1080x2400");
  assert.equal(info.appVersion, "2.9.0");
});

test("mergeConnectionInfo lets structured host/port/code win over paste", () => {
  const merged = mergeConnectionInfo(parseConnectionInfo(SAMPLE_PASTE), {
    host: "10.0.0.2",
    port: 9,
    code: "123456",
    deviceLabel: "Pixel · Android 15 · 1440x3120 · App 3.1.0",
  });
  assert.equal(merged.address, "10.0.0.2:9");
  assert.equal(merged.pairingCode, "123456");
  assert.equal(merged.brand, "Pixel");
  assert.equal(merged.androidVersion, "15");
  assert.equal(merged.resolution, "1440x3120");
  assert.equal(merged.appVersion, "3.1.0");
});

test("parsePairAck only acknowledges pair status — does not invent device fields", () => {
  const ack = parsePairAck(
    JSON.stringify({ status: "ok", paired: true, pairedAt: 1710000000000, device: { brand: "IGNORE" } })
  );
  assert.equal(ack.paired, true);
  assert.equal(ack.pairedAt, 1710000000000);
  assert.equal("device" in ack, false);
});

test("formatPairSuccessMessage combines user paste context with pair success and capabilities", () => {
  const text = formatPairSuccessMessage({
    ack: { paired: true, pairedAt: 1, rawBody: "{}" },
    connection: parseConnectionInfo(SAMPLE_PASTE),
    configuredEndpoint: "192.168.0.4:42091",
    logs: "ok\n",
    sessionOverrideApplied: true,
  });
  assert.match(text, /配对成功/);
  assert.match(text, /临时覆盖 MCP 进程 env/);
  assert.match(text, /地址：192\.168\.0\.4:42091/);
  assert.match(text, /Xiaomi/);
  assert.match(text, /Android 14/);
  assert.match(text, /1080x2400/);
  assert.match(text, /App：2\.9\.0/);
  assert.match(text, /capture_screenshot/);
  assert.match(text, /plans_deploy/);
  assert.doesNotMatch(text, /IGNORE/);
  assert.doesNotMatch(text, /541490/);
  assert.match(formatConnectedDeviceContext({ connection: parseConnectionInfo("") }), /未找到/);
  assert.match(formatCliCapabilities(), /get_kuaiyou_schema/);
});
