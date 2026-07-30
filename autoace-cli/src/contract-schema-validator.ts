import Ajv, { type ErrorObject } from "ajv";

export type ContractIssuePath = Array<string | number>;

export type ContractValidationIssue = {
  path: ContractIssuePath;
  message: string;
  keyword: string;
};

export type ContractValidationResult = {
  ok: boolean;
  issues: ContractValidationIssue[];
};

export type ContractValidator = (input: unknown) => ContractValidationResult;

const NOISY_BRANCH_KEYWORDS = new Set(["const", "type"]);

type VerboseErrorObject = ErrorObject & {
  parentSchema?: {
    const?: unknown;
    properties?: {
      type?: {
        const?: unknown;
      };
    };
  };
};

function decodePointerSegment(segment: string): string | number {
  const decoded = segment.replace(/~1/g, "/").replace(/~0/g, "~");
  return /^\d+$/.test(decoded) ? Number(decoded) : decoded;
}

function parsePointer(pointer: string): ContractIssuePath {
  if (!pointer) return [];
  return pointer
    .split("/")
    .slice(1)
    .map(decodePointerSegment);
}

function getAtPath(root: unknown, path: ContractIssuePath): unknown {
  let current = root;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function contextKind(input: unknown, path: ContractIssuePath): string {
  const label = pathToString(path);
  if (
    /(^|\.)action$/.test(label) ||
    /\.actions\[\d+\]$/.test(label) ||
    /\.onTrue\[\d+\]$/.test(label) ||
    /\.onFalse\[\d+\]$/.test(label) ||
    label === "launchApp"
  ) {
    return "action";
  }
  if (/(^|\.)trigger$/.test(label) || /\.triggers\[\d+\]$/.test(label)) return "trigger";
  if (/(^|\.)completion$/.test(label)) return "completion";
  if (/(^|\.)condition$/.test(label) || /\.conditions\[\d+\]$/.test(label)) return "condition";
  if (
    /(^|\.)target$/.test(label) ||
    label.endsWith(".when") ||
    label.endsWith(".dismiss") ||
    label.endsWith(".selector") ||
    label.endsWith(".scope") ||
    label.endsWith(".item") ||
    label.endsWith(".value") ||
    /\.fallbacks\[\d+\]$/.test(label)
  ) {
    return "target";
  }
  if (label === "source" || label.endsWith(".source")) {
    const parent = getAtPath(input, path.slice(0, -1));
    return parent && typeof parent === "object" && (parent as Record<string, unknown>).type === "forEach"
      ? "forEach source"
      : "source";
  }
  if (label === "termination" || label.endsWith(".termination")) return "termination";
  return "value";
}

function shouldDropBranchNoise(error: ErrorObject): boolean {
  return NOISY_BRANCH_KEYWORDS.has(error.keyword) && /\/(oneOf|anyOf)\//.test(error.schemaPath);
}

function shouldDropGenericUnionError(error: ErrorObject, allErrors: ErrorObject[]): boolean {
  if (error.keyword !== "oneOf" && error.keyword !== "anyOf") return false;
  const descendantPrefix = error.instancePath ? `${error.instancePath}/` : "/";
  if (
    allErrors.some(
      (other) => other !== error && other.instancePath.startsWith(descendantPrefix)
    )
  ) {
    return true;
  }
  if (
    error.keyword === "anyOf" &&
    allErrors.some((other) => other !== error && other.instancePath === error.instancePath && other.keyword === "oneOf")
  ) {
    return true;
  }
  return allErrors.some(
    (other) =>
      other !== error &&
      other.instancePath === error.instancePath &&
      !["oneOf", "anyOf", "const", "type"].includes(other.keyword)
  );
}

function expectedDiscriminator(error: ErrorObject): string | null {
  const verboseError = error as VerboseErrorObject;
  const value = verboseError.parentSchema?.properties?.type?.const ?? verboseError.parentSchema?.const;
  return typeof value === "string" ? value : null;
}

function actualDiscriminator(input: unknown, error: ErrorObject): string | null {
  const path = parsePointer(error.instancePath);
  const candidatePath =
    error.keyword === "const" && path[path.length - 1] === "type"
      ? path.slice(0, -1)
      : path;
  const candidate = getAtPath(input, candidatePath);
  if (!candidate || typeof candidate !== "object") return null;
  const value = (candidate as Record<string, unknown>).type;
  return typeof value === "string" ? value : null;
}

function shouldDropMismatchedBranchError(input: unknown, error: ErrorObject): boolean {
  if (!["required", "additionalProperties", "const"].includes(error.keyword)) return false;
  const expected = expectedDiscriminator(error);
  const actual = actualDiscriminator(input, error);
  return expected !== null && actual !== null && expected !== actual;
}

function filterSchemaErrors(input: unknown, errors: ErrorObject[] | null | undefined): ErrorObject[] {
  const withoutBranchNoise = (errors ?? []).filter(
    (error) => !shouldDropMismatchedBranchError(input, error) && !shouldDropBranchNoise(error)
  );
  return withoutBranchNoise.filter(
    (error) => !shouldDropGenericUnionError(error, withoutBranchNoise)
  );
}

function formatRequiredMessage(input: unknown, parentPath: ContractIssuePath, field: string): string {
  const parent = getAtPath(input, parentPath);
  if (parent && typeof parent === "object" && typeof (parent as Record<string, unknown>).type === "string") {
    return `type "${(parent as Record<string, unknown>).type}" requires "${field}"`;
  }
  return `"${field}" is required`;
}

function formatIssue(input: unknown, error: ErrorObject): ContractValidationIssue {
  let path = parsePointer(error.instancePath);
  let message = error.message ?? error.keyword;

  if (error.keyword === "required") {
    const field = String((error.params as { missingProperty?: string }).missingProperty ?? "");
    path = [...path, field];
    message = formatRequiredMessage(input, parsePointer(error.instancePath), field);
  } else if (error.keyword === "additionalProperties") {
    const field = String((error.params as { additionalProperty?: string }).additionalProperty ?? "");
    path = [...path, field];
    message = `unknown property "${field}"`;
  } else if (error.keyword === "enum") {
    const values = ((error.params as { allowedValues?: unknown[] }).allowedValues ?? []).map(String);
    if (values.length > 0) {
      message = `must be one of ${values.join(" | ")}`;
    }
  } else if (error.keyword === "oneOf" || error.keyword === "anyOf") {
    const current = getAtPath(input, path);
    if (current && typeof current === "object" && typeof (current as Record<string, unknown>).type === "string") {
      message = `unknown or invalid ${contextKind(input, path)} type "${(current as Record<string, unknown>).type}"`;
    } else {
      message = `does not match the ${contextKind(input, path)} contract`;
    }
  }

  return { path, message, keyword: error.keyword };
}

function dedupeIssues(issues: ContractValidationIssue[]): ContractValidationIssue[] {
  const seen = new Set<string>();
  const result: ContractValidationIssue[] = [];
  for (const issue of issues) {
    const key = `${pathToString(issue.path)}|${issue.keyword}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(issue);
  }
  return result;
}

export function pathToString(path: ContractIssuePath): string {
  if (path.length === 0) return "root";
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else if (!out) {
      out = segment;
    } else {
      out += `.${segment}`;
    }
  }
  return out;
}

export function createContractValidator(schema: unknown): ContractValidator {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("Device schema response must be a JSON object");
  }

  const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
  const validate = ajv.compile(schema);

  return (input: unknown): ContractValidationResult => {
    const issues: ContractValidationIssue[] = [];
    const ok = validate(input);
    if (!ok) {
      const filtered = filterSchemaErrors(input, validate.errors);
      issues.push(...filtered.map((error) => formatIssue(input, error)));
    }

    if (issues.length === 0) return { ok: true, issues: [] };
    return {
      ok: false,
      issues: dedupeIssues(issues),
    };
  };
}
