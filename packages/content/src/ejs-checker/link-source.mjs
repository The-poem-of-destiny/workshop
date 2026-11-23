import { parseFragment } from "parse5";
import { firstAttributeLocations } from "./source-units.mjs";

export function directUrls(content) {
  const items = [];
  const pattern = /(?:https?:\/\/|\/\/)(?:\[[0-9a-f:]+\]|(?:[a-z0-9-]+\.)+[a-z0-9-]+)(?:[^\s"'<>\\)\]]*)/gi;
  for (let match = pattern.exec(content); match; match = pattern.exec(content))
    items.push({ url: match[0].replace(/[;,\]}]+$/, ""), index: match.index, end: pattern.lastIndex });
  return items;
}
export function parsedUrl(value) {
  try {
    return new URL(value.startsWith("//") ? "https:" + value : value);
  } catch {
    return null;
  }
}
export function external(value) {
  const url = parsedUrl(value);
  return url && ["http:", "https:"].includes(url.protocol);
}

const MAX_SRCDOC_LINK_DEPTH = 4;

function collectCssMedia(css, start, { hints, covered, addTarget }) {
  // CSS strings can display literal "url(...)" prose. Mask strings/comments
  // only for locating syntax; keep the original text for URL argument values.
  const code = css.replace(/\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g, (value) =>
    value.replace(/[^\r\n]/g, " "),
  );
  const declarations =
    /(?:^|[;{])\s*(?:background(?:-image)?|border-image(?:-source)?|list-style(?:-image)?|(?:-webkit-)?mask(?:-image)?|content|cursor)\s*:\s*([^;}]+)/gi;
  for (let declaration = declarations.exec(code); declaration; declaration = declarations.exec(code)) {
    const valueStart = declaration.index + declaration[0].length - declaration[1].length;
    const value = css.slice(valueStart, valueStart + declaration[1].length);
    const urls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)"']+))\s*\)/gi;
    for (let match = urls.exec(value); match; match = urls.exec(value)) {
      const offset = valueStart + match.index;
      if (code.slice(offset, offset + 3).toLowerCase() !== "url" || /[\w-]/.test(code[offset - 1] ?? "")) continue;
      const index = start + offset;
      if (/<%|\$\{/.test(match[0]))
        hints.push({
          ruleId: "AH2",
          severity: "hint",
          title: "媒体来源需要人工确认",
          index,
          detail: "样式中的媒体地址由运行时内容决定。",
          suggestion: "请说明最终图片或视频地址的来源及用途。",
          extra: { riskEvidence: { action: "css.media", usage: "media", target: "dynamic", candidates: [] } },
        });
      covered.push({ start: index, end: index + match[0].length });
      addTarget(match[1] ?? match[2] ?? match[3], index, "media", "css.media");
    }
  }
}

function maskEjsForHtmlLinks(source, parsed, depth) {
  if (depth > 0) return source;
  const chars = source.split("");
  for (const range of parsed.units.find((unit) => unit.kind === "ejs")?.templateRanges ?? []) {
    for (let i = range.start; i < range.end; i++) {
      if (chars[i] !== "\r" && chars[i] !== "\n") chars[i] = " ";
    }
  }
  return chars.join("");
}

function collectStyleNodeMedia(node, source, addCssMedia) {
  for (const child of node.childNodes ?? []) {
    if (child.nodeName === "#text" && child.sourceCodeLocation) {
      addCssMedia(
        source.slice(child.sourceCodeLocation.startOffset, child.sourceCodeLocation.endOffset),
        child.sourceCodeLocation.startOffset,
      );
    }
  }
}

function collectHtmlLinkTargets(source, parsed, context, baseOffset = 0, depth = 0) {
  const addCssMedia = (css, start) => collectCssMedia(css, baseOffset + start, context);
  const html = parseFragment(maskEjsForHtmlLinks(source, parsed, depth), { sourceCodeLocationInfo: true }),
    pending = [...html.childNodes];
  while (pending.length) {
    const node = pending.shift();
    if (!node.tagName) continue;
    const locations = firstAttributeLocations(source, node.sourceCodeLocation?.startTag);
    for (const attribute of node.attrs ?? []) {
      const location = locations.get(attribute.prefix ? attribute.prefix + ":" + attribute.name : attribute.name);
      if (location) collectHtmlAttribute(source, node, attribute, location, context, baseOffset, depth);
    }
    if (node.tagName === "style") collectStyleNodeMedia(node, source, addCssMedia);
    if (node.tagName !== "template") pending.push(...(node.childNodes ?? []));
  }
}

export function collectSourceLinkTargets(source, parsed, context, baseOffset = 0, depth = 0) {
  const { covered, addTarget } = context;
  collectHtmlLinkTargets(source, parsed, context, baseOffset, depth);
  const markdown = /(!?)\[[^[\]\r\n]*\]\((https?:\/\/[^\s)]+|\/\/[^\s)]+)(?:\s+"[^"]*")?\)/gi;
  for (let match = markdown.exec(source); match; match = markdown.exec(source)) {
    covered.push({ start: baseOffset + match.index, end: baseOffset + markdown.lastIndex });
    addTarget(
      match[2],
      baseOffset + match.index,
      match[1] ? "media" : "navigation",
      match[1] ? "markdown.image" : "markdown.link",
    );
  }
  const raw = source.replace(/<%#\s*poem-workshop-meta:v1-start[\s\S]*?poem-workshop-meta:v1-end\s*%>/gi, (value) =>
    value.replace(/[^\r\n]/g, " "),
  );
  for (const item of directUrls(raw)) {
    const globalIndex = baseOffset + item.index;
    if (
      !covered.some((range) => globalIndex >= range.start && globalIndex < range.end) &&
      (depth > 0 ||
        !parsed.units.some((unit) =>
          unit.codeRanges.some((range) => globalIndex >= range.originalStart && globalIndex < range.originalEnd),
        ))
    ) {
      addTarget(item.url, globalIndex, "unknown", "resource");
    }
  }
}

function collectHtmlAttribute(source, node, attribute, location, context, baseOffset = 0, depth = 0) {
  const { hints, covered, addTarget } = context;
  const attrStart = baseOffset + location.startOffset;
  const attrEnd = baseOffset + location.endOffset;
  if (attribute.name === "style") {
    const rawAttribute = source.slice(location.startOffset, location.endOffset);
    const prefix = /^[^=]+=\s*["']?/.exec(rawAttribute)?.[0].length ?? 0;
    collectCssMedia(rawAttribute.slice(prefix), attrStart + prefix, context);
    return;
  }
  if (node.tagName === "iframe" && attribute.name === "srcdoc") {
    const rawAttribute = source.slice(location.startOffset, location.endOffset);
    if (/<%[=-]?/.test(rawAttribute)) {
      hints.push({
        ruleId: "AH2",
        severity: "hint",
        title: "内嵌文档内容需要人工确认",
        index: attrStart,
        detail: "iframe srcdoc 包含运行时动态内容。",
        suggestion: "请说明内嵌文档内容的来源及用途。",
        extra: { riskEvidence: { action: "iframe.srcdoc", usage: "unknown", target: "dynamic", candidates: [] } },
      });
    }
    covered.push({ start: attrStart, end: attrEnd });
    if (depth < MAX_SRCDOC_LINK_DEPTH) {
      const nestedContext = {
        ...context,
        covered: [],
        addTarget: (value, _idx, usage, action, expression) => addTarget(value, attrStart, usage, action, expression),
      };
      collectSourceLinkTargets(attribute.value, { units: [] }, nestedContext, attrStart, depth + 1);
    }
    return;
  }
  const isObjectData = node.tagName === "object" && attribute.name === "data";
  if (!isObjectData && !["href", "src", "poster", "srcset", "action", "formaction"].includes(attribute.name)) return;

  const isCodeEmbedAttr =
    (["script", "iframe", "embed"].includes(node.tagName) && attribute.name === "src") || isObjectData;
  const schemeMatch = isCodeEmbedAttr
    ? /^(data|blob|javascript):/i.exec(attribute.value.replace(/[\t\r\n]/g, "").replace(/^[\u0000-\u0020]+/, ""))
    : null;
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase() + ":";
    const action = node.tagName + "." + attribute.name;
    hints.push({
      ruleId: "M4",
      severity: "warn",
      title: "检测到内联或本地对象资源加载，需要审核",
      index: attrStart,
      detail: `${action} 使用了 ${scheme} 协议加载脚本或嵌入内容。`,
      suggestion: "请由审核员确认该内联或对象 URL 的实际内容与用途。",
      extra: {
        riskEvidence: {
          action,
          usage: "network",
          target: attribute.value.slice(0, 200),
          method: "GET",
        },
      },
    });
    hints.push({
      ruleId: "AH2",
      severity: "hint",
      title: "内联或动态协议资源需要人工确认",
      index: attrStart,
      detail: `${action} 使用了 ${scheme} 协议。`,
      suggestion: "请向审核员说明该嵌入资源的来源及用途。",
      extra: {
        riskEvidence: {
          action,
          usage: "unknown",
          target: scheme,
          candidates: [],
        },
      },
    });
  }

  const media =
    (attribute.name === "src" && ["img", "video", "source", "audio"].includes(node.tagName)) ||
    attribute.name === "poster" ||
    (attribute.name === "srcset" && ["img", "source"].includes(node.tagName));
  const usage = media ? "media" : ["href", "action", "formaction"].includes(attribute.name) ? "navigation" : "unknown";
  const rawAttribute = source.slice(location.startOffset, location.endOffset);
  if (/<%[=-]?/.test(rawAttribute)) {
    hints.push({
      ruleId: "AH2",
      severity: "hint",
      title: media ? "媒体来源需要人工确认" : "外部目标需要人工确认",
      index: attrStart,
      detail: "最终地址由运行时内容决定。",
      suggestion: "请说明最终地址的来源及用途。",
      extra: {
        riskEvidence: { action: node.tagName + "." + attribute.name, usage, target: "dynamic", candidates: [] },
      },
    });
    covered.push({ start: attrStart, end: attrEnd });
    for (const item of directUrls(rawAttribute))
      addTarget(item.url, attrStart + item.index, "unknown", node.tagName + "." + attribute.name);
    return;
  }
  covered.push({ start: attrStart, end: attrEnd });
  if (attribute.name !== "srcset" && external(attribute.value))
    addTarget(attribute.value, attrStart, usage, node.tagName + "." + attribute.name);
  else
    for (const item of directUrls(attribute.value))
      addTarget(item.url, attrStart, usage, node.tagName + "." + attribute.name);
}
