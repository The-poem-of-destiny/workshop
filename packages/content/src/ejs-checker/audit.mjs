import { parseFragment } from "parse5";
import { CHECKER_VERSION } from "./index.mjs";
import { CHECKER_LIMITS, createParseBudget } from "./limits.mjs";
import { CHECK_POLICY_VERSION, trustedAssetHosts } from "./policy-config.mjs";
import { certificationStatus, gateStatus, parseCodeCheckInput } from "./report.mjs";
import { parseEjs, parseRegex } from "./syntax.mjs";

const OMIT_AST = new Set(["start", "end", "loc", "range", "raw"]);
const MAX_AUDIT_DEPTH = 64;
function canonical(value, ast = false, depth = 0) {
  if (typeof value === "bigint") return { bigint: String(value) };
  if (value instanceof RegExp) return { regex: value.source, flags: value.flags };
  if (!value || typeof value !== "object") return value;
  if (depth >= MAX_AUDIT_DEPTH) {
    return typeof value.type === "string" ? { type: value.type, truncated: true } : "[truncated]";
  }
  if (Array.isArray(value)) return value.map((item) => canonical(item, ast, depth + 1));
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => !ast || !OMIT_AST.has(key))
      .map((key) => [key, canonical(value[key], ast, depth + 1)]),
  );
}
const stable = (value) => JSON.stringify(canonical(value));
/** Full reviewer-facing rule identity. Shared with the server so both sides can
 * recompute it cheaply and compare it byte for byte without executing rules. */
function buildReviewPolicyVersion(checkerVersion) {
  return stable({
    policy: CHECK_POLICY_VERSION,
    engine: checkerVersion.engine,
    parserCompatibility: checkerVersion.parserCompatibility,
    standard: "PW-CODE-CHECK-v1",
    rules:
      "EJS:L1-L7; COMMON:M1-M5,U2-U5; API:API1-API2; HINTS:AH1-AH4; EJS-PARSE,JS-PARSE,CHECKER-INTERNAL,CHECKER-LIMIT",
    trustedAssetHosts,
  });
}
async function digest(value) {
  const bytes = new TextEncoder().encode(stable(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function unitMeaning(unit) {
  if (!unit.ast) return { kind: unit.kind, unparsed: unit.code };
  function normalize(node, depth = 0) {
    if (Array.isArray(node)) return node.map((item) => normalize(item, depth + 1)).filter((value) => value !== null);
    if (!node || typeof node !== "object") return canonical(node, false, depth);
    if (depth >= MAX_AUDIT_DEPTH) {
      return { unparsed: unit.code };
    }
    const isAst = typeof node.type === "string" && Number.isInteger(node.start);
    if (isAst && !unit.sourceMap.isOriginal(node.start)) {
      if (node.type === "EmptyStatement") return null;
      if (
        node.type === "ExpressionStatement" &&
        node.expression.type === "UnaryExpression" &&
        node.expression.operator === "void" &&
        node.expression.argument.type === "Literal" &&
        !unit.sourceMap.isOriginal(node.expression.argument.start)
      )
        return null;
    }
    return Object.fromEntries(
      Object.keys(node)
        .sort()
        .filter((key) => !OMIT_AST.has(key))
        .map((key) => [key, normalize(node[key], depth + 1)]),
    );
  }
  return { kind: unit.kind, ast: normalize(unit.wrapperFunction ? unit.wrapperFunction.body.body : unit.ast) };
}

function htmlMeaning(source, budget) {
  if (budget.nodes >= CHECKER_LIMITS.astNodes || budget.units >= CHECKER_LIMITS.codeUnits) {
    return { unparsed: source };
  }
  const parsed = parseRegex(source, budget);
  if (parsed.internalErrors.length) return { unparsed: source };
  const tree = parseFragment(source, { scriptingEnabled: true, sourceCodeLocationInfo: true });
  const executable = parsed.units;
  function nodeMeaning(node, depth = 0) {
    if (depth >= MAX_AUDIT_DEPTH) return { unparsed: source };
    if (node.nodeName === "#text") {
      if (/^\s*$/.test(node.value)) return null;
      // Synthetic template markers carry no literal output value. Ignore only
      // surrounding layout lines; actual strings and meaningful text stay exact.
      return { text: node.value.includes("__PW_EJS_") ? node.value.replace(/^[\r\n]+|[\r\n]+$/g, "") : node.value };
    }
    if (node.nodeName === "#comment") return null;
    const location = node.sourceCodeLocation;
    const scriptUnits =
      node.tagName === "script" && location
        ? executable.filter(
            (unit) =>
              ["script", "module"].includes(unit.kind) &&
              unit.codeRanges.every(
                (range) => range.originalStart >= location.startOffset && range.originalEnd <= location.endOffset,
              ),
          )
        : [];
    const attrs = (node.attrs ?? [])
      .map((attribute) => {
        const name = attribute.prefix ? attribute.prefix + ":" + attribute.name : attribute.name;
        const attrLocation = location?.attrs?.[name];
        const unit =
          attrLocation &&
          executable.find(
            (candidate) =>
              ["event", "javascript-url"].includes(candidate.kind) &&
              candidate.codeRanges.length &&
              candidate.codeRanges.every(
                (range) =>
                  range.originalStart >= attrLocation.startOffset && range.originalEnd <= attrLocation.endOffset,
              ),
          );
        return { name, namespace: attribute.namespace ?? "", value: unit ? unitMeaning(unit) : attribute.value };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      tag: node.tagName ?? node.nodeName,
      namespace: node.namespaceURI ?? "",
      attrs,
      children: scriptUnits.length
        ? scriptUnits.map(unitMeaning)
        : (node.childNodes ?? []).map((child) => nodeMeaning(child, depth + 1)).filter(Boolean),
      ...(node.content ? { template: nodeMeaning(node.content, depth + 1) } : {}),
    };
  }
  return nodeMeaning(tree);
}

function entryMeaning(entry, budget) {
  const source = String(entry.rawContent ?? entry.content ?? "");
  if (budget.nodes >= CHECKER_LIMITS.astNodes || budget.units >= CHECKER_LIMITS.codeUnits) {
    return { unparsed: source };
  }
  if (entry.sourceType !== "worldbook" || !entry.hasEjs) return htmlMeaning(source, budget);
  const parsed = parseEjs(source, { privateScope: entry.isPrivate, budget });
  if (parsed.errors.length || parsed.internalErrors.length) return { unparsed: source };
  const unit = parsed.units[0];
  let cursor = 0,
    scaffold = "";
  for (const [ordinal, range] of unit.templateRanges.entries()) {
    scaffold += source.slice(cursor, range.start);
    if (range.mode !== "#")
      scaffold += "__PW_EJS_" + ordinal + "_" + range.mode.replace(/[^a-z0-9]/gi, "output") + "__";
    cursor = range.end;
  }
  scaffold += source.slice(cursor);
  return { private: entry.isPrivate, javascript: unitMeaning(unit), template: htmlMeaning(scaffold, budget) };
}

function reviewerRisk(finding) {
  return (
    finding.severity === "high" ||
    (finding.visibility === "reviewer_only" &&
      ["warn", "hint"].includes(finding.severity) &&
      /^(?:M[34]|U[2-5]|AH[1-4])$/.test(finding.ruleId))
  );
}
function normalizedEvidence(evidence, budget) {
  if (!evidence) return null;
  const result = { ...evidence };
  if (
    typeof result.expression === "string" &&
    budget.nodes < CHECKER_LIMITS.astNodes &&
    budget.units < CHECKER_LIMITS.codeUnits
  ) {
    const parsed = parseEjs("<% " + result.expression + " %>", { budget });
    if (!parsed.errors.length && !parsed.internalErrors.length) result.expression = parsed.units.map(unitMeaning);
  }
  return canonical(result);
}

/** Only hashes and short finding summaries are persisted, never the uploaded source. */
export async function buildAuditSnapshot(inputs, report) {
  const budget = createParseBudget();
  const checkerVersion = {
    engine: report.engine ?? CHECKER_VERSION.engine,
    parserCompatibility: report.parserCompatibility ?? CHECKER_VERSION.parserCompatibility,
  };
  const policyVersion =
    report.standard === undefined
      ? buildReviewPolicyVersion(CHECKER_VERSION)
      : stable({
          policy: CHECK_POLICY_VERSION,
          ...checkerVersion,
          standard: report.standard,
          rules: report.rules,
          trustedAssetHosts,
        });
  const filesHash = await digest(
    inputs.map((input) => ({ type: input.type === "regex" ? "regex" : "worldbook", text: String(input.text ?? "") })),
  );
  const books = inputs.map((input, index) => parseCodeCheckInput(input, index));
  const entries = books.flatMap((book) => book.entries);
  const withinEntryLimit = entries.length <= CHECKER_LIMITS.entries;
  const entryMeanings = new Map(
    entries.map((entry) => [
      entry.id,
      withinEntryLimit ? entryMeaning(entry, budget) : { unparsed: String(entry.rawContent ?? entry.content ?? "") },
    ]),
  );
  const entryHashes = new Map(
    await Promise.all(entries.map(async (entry) => [entry.id, await digest(entryMeanings.get(entry.id))])),
  );
  const meanings = entries.map((entry) => ({
    type: entry.sourceType,
    uid: String(entry.uid),
    meaning: entryMeanings.get(entry.id),
  }));
  const filesMeaning = books.map((book, index) => {
    const contents = new Map(
      book.entries.map((entry) => [entry.rawContent ?? entry.content, entryMeanings.get(entry.id)]),
    );
    function normalizeInput(value) {
      if (Array.isArray(value)) return value.map(normalizeInput);
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          ["content", "replaceString"].includes(key) && typeof child === "string" && contents.has(child)
            ? contents.get(child)
            : normalizeInput(child),
        ]),
      );
    }
    return { type: book.type, data: normalizeInput(JSON.parse(inputs[index].text)) };
  });
  // Whole-project semantics cover definitions, request headers/body and cross-entry dependencies.
  // Any other code change deliberately causes conservative re-review of these risks.
  const projectHash = await digest({ entries: meanings, files: filesMeaning });
  const counters = new Map(),
    identities = new Map();
  for (const entry of entries) {
    const base = entry.sourceType + ":" + String(entry.uid),
      ordinal = counters.get(base) ?? 0;
    counters.set(base, ordinal + 1);
    identities.set(entry.id, base + ":" + ordinal);
  }
  const occurrences = new Map(),
    findings = [];
  for (const item of report.findings.filter(reviewerRisk)) {
    const entry = entries.find((candidate) => candidate.id === item.entryId);
    const identity = identities.get(item.entryId) ?? "unmatched:" + String(item.uid);
    const base = identity + ":" + item.ruleId,
      occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    const key = base + ":" + occurrence;
    const fingerprint = await digest({
      policyVersion,
      projectHash,
      entryHash: entry ? entryHashes.get(entry.id) : null,
      rule: item.ruleId,
      occurrence,
      evidence: normalizedEvidence(item.riskEvidence, budget),
    });
    findings.push({
      key,
      fingerprint,
      rule: item.ruleId,
      entryId: item.entryId,
      book: item.book,
      entry: item.entry,
      uid: item.uid,
      line: item.line,
      column: item.column,
      detail: String(item.detail ?? "").slice(0, 500),
    });
  }
  return { policyVersion, ...checkerVersion, filesHash, findings };
}

export function applyAuditBaseline(report, snapshot, acceptedEnvelope) {
  const previous = Array.isArray(acceptedEnvelope?.findings) ? acceptedEnvelope.findings : [];
  const previousByKey = new Map(previous.map((item) => [item.key, item]));
  const currentKeys = new Set(snapshot.findings.map((item) => item.key));
  const samePolicy = acceptedEnvelope?.policyVersion === snapshot.policyVersion;
  const statusByKey = new Map(
    snapshot.findings.map((item) => {
      const old = previousByKey.get(item.key);
      return [item.key, old ? (samePolicy && old.fingerprint === item.fingerprint ? "accepted" : "changed") : "new"];
    }),
  );
  let riskIndex = 0;
  const findings = report.findings.map((item) => {
    if (!reviewerRisk(item)) return item;
    const evidence = snapshot.findings[riskIndex++];
    return {
      ...item,
      reviewState: statusByKey.get(evidence.key),
      auditKey: evidence.key,
      ...(statusByKey.get(evidence.key) === "accepted"
        ? { reviewedAt: acceptedEnvelope.reviewedAt, reviewerId: acceptedEnvelope.reviewerId }
        : {}),
    };
  });
  const removed = previous
    .filter((item) => !currentKeys.has(item.key))
    .map((item) => ({ ...item, reviewState: "removed" }));
  const summary = { new: 0, changed: 0, accepted: 0, removed: removed.length, pending: 0 };
  for (const state of statusByKey.values()) summary[state]++;
  const pendingFindings = findings.filter((item) => item.reviewState !== "accepted");
  summary.pending = pendingFindings.filter((item) => ["high", "warn", "hint"].includes(item.severity)).length;
  const gate = report.gate === "reject" ? "reject" : gateStatus(findings);
  return {
    ...report,
    findings,
    gate,
    certification: gate === "reject" ? "fail" : certificationStatus(pendingFindings),
    audit: gate === "reject" ? "not_applicable" : summary.pending ? "yellow" : "green",
    auditSummary: summary,
    removedFindings: removed,
  };
}
