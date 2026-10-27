import { isDynamicUrlCandidate } from "../external-links/policy.mjs";
import { collectAstLinkTargets } from "./link-ast.mjs";
import { collectSourceLinkTargets, external, parsedUrl } from "./link-source.mjs";
import { trustedStaticMediaUrl } from "./policy-config.mjs";

const OFFICIAL_URL_RULES = [
  { host: "testingcf.jsdelivr.net", path: /^\/gh\/StageDog\/tavern_resource(?:\/|$)/i },
  { host: "cdn.jsdelivr.net", path: /^\/gh\/StageDog\/tavern_resource(?:\/|$)/i },
  { host: "raw.githubusercontent.com", path: /^\/StageDog\/tavern_resource(?:\/|$)/i },
  { host: "github.com", path: /^\/zonde306\/ST-Prompt-Template(?:\/|$)/i },
];
function ipHost(host) {
  return host.includes(":") || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
}

export function collectEntryExternalLinkTargets(entry, parsed) {
  const source = String(entry.rawContent ?? entry.content ?? ""),
    targets = [],
    hints = [],
    covered = [],
    seen = new Set();
  const addTarget = (value, index, usage, action, expression = "") => {
    if (!external(value)) return;
    const key = index + "|" + value + "|" + usage;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ value, index, usage, action, expression });
  };
  const context = { source, addTarget, hints, covered };
  for (const unit of parsed.units ?? []) {
    if (unit.ast) collectAstLinkTargets(unit, context);
  }
  collectSourceLinkTargets(source, parsed, context);
  return { targets, hints };
}

export function inspectExternalLinks(entry, parsed) {
  const { targets, hints } = collectEntryExternalLinkTargets(entry, parsed);
  const findings = [...hints];
  for (const target of targets) {
    const url = parsedUrl(target.value),
      dynamic = isDynamicUrlCandidate(target.value);
    if (/^http:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink)$/i.test(target.value)) continue;
    const extra = {
      riskEvidence: { action: target.action, usage: target.usage, target: target.value, expression: target.expression },
    };
    if (dynamic)
      findings.push({
        ruleId: "U5",
        severity: "warn",
        title: "远程目标包含运行时替换内容",
        index: target.index,
        detail: target.value,
        suggestion: "请提供所有可能访问的目标，或向审核员说明动态目标的来源和用途。",
        extra,
      });
    if (!dynamic && trustedStaticMediaUrl(target.value, target.usage)) continue;
    const official = OFFICIAL_URL_RULES.some(
      (rule) => url.hostname.toLowerCase() === rule.host && rule.path.test(url.pathname),
    );
    const ruleId = ipHost(url.hostname) ? "U4" : url.protocol === "http:" ? "U3" : official ? null : "U2";
    if (ruleId)
      findings.push({
        ruleId,
        severity: "warn",
        title:
          ruleId === "U4" ? "外部目标使用 IP 地址" : ruleId === "U3" ? "外部目标使用 HTTP" : "外部目标需要确认来源",
        index: target.index,
        detail: target.value,
        suggestion:
          target.usage === "navigation"
            ? "请向审核员说明用户将被带往哪里，以及为什么需要这个跳转。"
            : "请确认这个目标是项目需要的资源来源；这条提示本身不代表违规。",
        extra,
      });
  }
  return findings;
}
