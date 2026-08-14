/** Compact screen observation for Agents — clickable nodes + optional screenshot. */

export const OBSERVE_MAX_NODES = 80;

export type ParsedBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export type ObserveNode = {
  text?: string;
  desc?: string;
  id?: string;
  className?: string;
  clickable?: boolean;
  longClickable?: boolean;
  checkable?: boolean;
  editable?: boolean;
  bounds?: ParsedBounds;
  centerPct?: { x: number; y: number };
};

export type ObserveSummary = {
  packageName?: string;
  activity?: string;
  screen?: { width: number; height: number };
  nodeCount: number;
  interactiveCount: number;
  truncated: boolean;
  nodes: ObserveNode[];
};

export function parseBoundsStr(boundsStr: string): ParsedBounds | string {
  const match = boundsStr.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  if (match) {
    const left = parseInt(match[1], 10);
    const top = parseInt(match[2], 10);
    const right = parseInt(match[3], 10);
    const bottom = parseInt(match[4], 10);
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      centerX: Math.floor((left + right) / 2),
      centerY: Math.floor((top + bottom) / 2),
    };
  }
  return boundsStr;
}

export function enhanceUiNodes(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(enhanceUiNodes);
  }
  if (data !== null && typeof data === "object") {
    const newData: Record<string, unknown> = {};
    for (const key of Object.keys(data as Record<string, unknown>)) {
      const value = (data as Record<string, unknown>)[key];
      if (key === "bounds" && typeof value === "string") {
        newData[key] = parseBoundsStr(value);
      } else {
        newData[key] = enhanceUiNodes(value);
      }
    }
    return newData;
  }
  return data;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function truthyFlag(value: unknown): boolean {
  return value === true || value === "true" || value === "True";
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function shortClassName(className: string | undefined): string | undefined {
  if (!className) return undefined;
  const parts = className.split(".");
  return parts[parts.length - 1] || className;
}

function coerceBounds(value: unknown): ParsedBounds | undefined {
  if (typeof value === "string") {
    const parsed = parseBoundsStr(value);
    return typeof parsed === "string" ? undefined : parsed;
  }
  const rec = asRecord(value);
  if (!rec) return undefined;
  const left = Number(rec.left);
  const top = Number(rec.top);
  const right = Number(rec.right);
  const bottom = Number(rec.bottom);
  if (![left, top, right, bottom].every(Number.isFinite)) return undefined;
  return {
    left,
    top,
    right,
    bottom,
    width: typeof rec.width === "number" ? rec.width : right - left,
    height: typeof rec.height === "number" ? rec.height : bottom - top,
    centerX: typeof rec.centerX === "number" ? rec.centerX : Math.floor((left + right) / 2),
    centerY: typeof rec.centerY === "number" ? rec.centerY : Math.floor((top + bottom) / 2),
  };
}

function childLists(record: Record<string, unknown>): unknown[] {
  const lists: unknown[] = [];
  for (const key of ["children", "nodes", "node", "descendants", "windows"]) {
    const value = record[key];
    if (Array.isArray(value)) lists.push(...value);
    else if (value && typeof value === "object") lists.push(value);
  }
  return lists;
}

function isInteractive(record: Record<string, unknown>): boolean {
  return (
    truthyFlag(record.clickable) ||
    truthyFlag(record.longClickable) ||
    truthyFlag(record.checkable) ||
    truthyFlag(record.editable) ||
    truthyFlag(record.focusable)
  );
}

function toObserveNode(record: Record<string, unknown>, screen?: { width: number; height: number }): ObserveNode | null {
  const bounds = coerceBounds(record.bounds);
  if (bounds && (bounds.width <= 0 || bounds.height <= 0)) return null;

  const node: ObserveNode = {};
  const text = firstString(record, ["text", "label", "name"]);
  const desc = firstString(record, ["contentDescription", "content-desc", "desc", "contentDesc"]);
  const id = firstString(record, ["resourceId", "resource-id", "viewIdResourceName", "viewId", "id"]);
  const className = shortClassName(firstString(record, ["className", "class", "type"]));

  if (text) node.text = text.slice(0, 80);
  if (desc) node.desc = desc.slice(0, 80);
  if (id) node.id = id;
  if (className) node.className = className;
  if (truthyFlag(record.clickable)) node.clickable = true;
  if (truthyFlag(record.longClickable)) node.longClickable = true;
  if (truthyFlag(record.checkable)) node.checkable = true;
  if (truthyFlag(record.editable)) node.editable = true;
  if (bounds) {
    node.bounds = bounds;
    if (screen && screen.width > 0 && screen.height > 0) {
      node.centerPct = {
        x: Math.round((bounds.centerX / screen.width) * 1000) / 1000,
        y: Math.round((bounds.centerY / screen.height) * 1000) / 1000,
      };
    }
  }

  if (!node.text && !node.desc && !node.id && !node.clickable && !node.editable && !node.longClickable && !node.checkable) {
    return null;
  }
  return node;
}

function walkNodes(value: unknown, visit: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkNodes(item, visit);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  visit(record);
  for (const child of childLists(record)) walkNodes(child, visit);
}

function inferScreen(root: unknown): { width: number; height: number } | undefined {
  let best: ParsedBounds | undefined;
  walkNodes(root, (record) => {
    const bounds = coerceBounds(record.bounds);
    if (!bounds) return;
    if (!best || bounds.width * bounds.height > best.width * best.height) best = bounds;
  });
  if (!best || best.width <= 0 || best.height <= 0) return undefined;
  return { width: best.width, height: best.height };
}

/**
 * Reduce a device UI tree to interactive (and, if few of those, labeled) nodes.
 * Unknown fields are ignored so App payload shape can evolve.
 */
export function summarizeScreenTree(tree: unknown, maxNodes = OBSERVE_MAX_NODES): ObserveSummary {
  const root = asRecord(tree) ?? {};
  const packageName = firstString(root, ["packageName", "package", "currentPackage", "appPackage", "pkg"]);
  const activity = firstString(root, ["activity", "activityName", "currentActivity"]);
  const screen = inferScreen(tree);

  const interactive: ObserveNode[] = [];
  const labeled: ObserveNode[] = [];
  let nodeCount = 0;

  walkNodes(tree, (record) => {
    nodeCount += 1;
    const node = toObserveNode(record, screen);
    if (!node) return;
    if (isInteractive(record)) interactive.push(node);
    else if (node.text || node.desc) labeled.push(node);
  });

  const preferred = interactive.length > 0 ? interactive : labeled;
  const truncated = preferred.length > maxNodes;
  return {
    packageName,
    activity,
    screen,
    nodeCount,
    interactiveCount: interactive.length,
    truncated,
    nodes: preferred.slice(0, maxNodes),
  };
}

export function formatObserveSummary(summary: ObserveSummary, screenshotNote?: string): string {
  const lines = [
    "Screen observation (compact). Prefer this over get_ui_tree unless you need the full dump.",
    `nodes scanned: ${summary.nodeCount}; interactive: ${summary.interactiveCount}; returned: ${summary.nodes.length}${summary.truncated ? " (truncated)" : ""}`,
  ];
  if (summary.packageName) lines.push(`package: ${summary.packageName}`);
  if (summary.activity) lines.push(`activity: ${summary.activity}`);
  if (summary.screen) lines.push(`screen: ${summary.screen.width}x${summary.screen.height}`);
  if (screenshotNote) lines.push(screenshotNote);
  lines.push("");
  lines.push(JSON.stringify({ nodes: summary.nodes }, null, 2));
  return lines.join("\n");
}
