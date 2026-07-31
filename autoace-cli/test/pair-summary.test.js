const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePairAck,
  parseConnectionInfo,
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
  assert.equal(info.brand, "Xiaomi");
  assert.equal(info.androidVersion, "14");
  assert.equal(info.resolution, "1080x2400");
  assert.equal(info.appVersion, "2.9.0");
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
  });
  assert.match(text, /配对成功/);
  assert.match(text, /地址：192\.168\.0\.4:42091/);
  assert.match(text, /Xiaomi/);
  assert.match(text, /Android 14/);
  assert.match(text, /1080x2400/);
  assert.match(text, /App：2\.9\.0/);
  assert.match(text, /capture_screenshot/);
  assert.match(text, /plans_deploy/);
  assert.doesNotMatch(text, /IGNORE/);
  assert.match(formatConnectedDeviceContext({ connection: parseConnectionInfo("") }), /未找到/);
  assert.match(formatCliCapabilities(), /get_kuaiyou_schema/);
});
