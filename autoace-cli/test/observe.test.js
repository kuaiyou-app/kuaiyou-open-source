const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  enhanceUiNodes,
  formatObserveSummary,
  OBSERVE_MAX_NODES,
  parseBoundsStr,
  summarizeScreenTree,
} = require("../build/observe.js");

const SAMPLE_TREE = {
  packageName: "com.ss.android.article.news",
  activity: "MainActivity",
  bounds: "[0,0][1080,2400]",
  children: [
    {
      className: "android.widget.FrameLayout",
      bounds: "[0,0][1080,2400]",
      children: [
        {
          text: "去签到",
          resourceId: "com.ss.android.article.news:id/checkin",
          className: "android.widget.Button",
          clickable: "true",
          bounds: "[100,200][400,280]",
        },
        {
          "content-desc": "关闭",
          clickable: true,
          bounds: "[980,80][1060,160]",
        },
        {
          text: "热榜",
          className: "android.widget.TextView",
          bounds: "[40,400][200,460]",
        },
        {
          className: "android.view.View",
          bounds: "[0,0][0,0]",
          clickable: true,
        },
        {
          text: "搜索",
          editable: true,
          className: "android.widget.EditText",
          bounds: "[40,80][800,160]",
        },
      ],
    },
  ],
};

test("parseBoundsStr extracts centers", () => {
  assert.deepEqual(parseBoundsStr("[100,200][400,280]"), {
    left: 100,
    top: 200,
    right: 400,
    bottom: 280,
    width: 300,
    height: 80,
    centerX: 250,
    centerY: 240,
  });
  assert.equal(parseBoundsStr("not-bounds"), "not-bounds");
});

test("enhanceUiNodes rewrites bounds strings", () => {
  const enhanced = enhanceUiNodes({ bounds: "[0,0][10,10]", child: { bounds: "[1,1][2,2]" } });
  assert.equal(enhanced.bounds.centerX, 5);
  assert.equal(enhanced.child.bounds.width, 1);
});

test("summarizeScreenTree keeps interactive nodes and drops empty ones", () => {
  const summary = summarizeScreenTree(SAMPLE_TREE);
  assert.equal(summary.packageName, "com.ss.android.article.news");
  assert.equal(summary.activity, "MainActivity");
  assert.equal(summary.screen.width, 1080);
  assert.equal(summary.screen.height, 2400);
  assert.equal(summary.interactiveCount, 3);
  assert.equal(summary.nodes.length, 3);
  assert.deepEqual(
    summary.nodes.map((n) => n.text || n.desc),
    ["去签到", "关闭", "搜索"]
  );
  const checkin = summary.nodes[0];
  assert.equal(checkin.id, "com.ss.android.article.news:id/checkin");
  assert.equal(checkin.className, "Button");
  assert.equal(checkin.clickable, true);
  assert.deepEqual(checkin.centerPct, { x: 0.231, y: 0.1 });
  assert.equal(
    summary.nodes.some((n) => n.text === "热榜"),
    false,
    "non-interactive labels are omitted when interactive nodes exist"
  );
});

test("summarizeScreenTree falls back to labeled nodes when nothing is clickable", () => {
  const summary = summarizeScreenTree({
    package: "com.example.app",
    children: [{ text: "今日头条", bounds: "[0,0][200,80]" }],
  });
  assert.equal(summary.packageName, "com.example.app");
  assert.equal(summary.interactiveCount, 0);
  assert.equal(summary.nodes[0].text, "今日头条");
});

test("summarizeScreenTree truncates at the cap", () => {
  const children = Array.from({ length: OBSERVE_MAX_NODES + 5 }, (_, i) => ({
    text: `item-${i}`,
    clickable: true,
    bounds: `[0,${i * 10}][10,${i * 10 + 8}]`,
  }));
  const summary = summarizeScreenTree({ children });
  assert.equal(summary.truncated, true);
  assert.equal(summary.nodes.length, OBSERVE_MAX_NODES);
  assert.equal(summary.interactiveCount, OBSERVE_MAX_NODES + 5);
});

test("formatObserveSummary tells agents to prefer the compact view", () => {
  const text = formatObserveSummary(summarizeScreenTree(SAMPLE_TREE));
  assert.match(text, /Prefer this over get_ui_tree/);
  assert.match(text, /package: com\.ss\.android\.article\.news/);
  assert.match(text, /去签到/);
});
