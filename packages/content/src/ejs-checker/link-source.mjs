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

function collectCssMedia(css, start, { hints, covered, addTarget }) {
  // CSS strings can display literal "url(...)" prose. Mask strings/comments
  // only for locating syntax; keep the original text for URL argument values.
  const code = css.replace(/\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g, (value) =>
    value.replace(/[^\r\n]/g, " "),
  );
  const declarations =
    /(?:^|[;{])\s*(?:background(?:-image)?|border-image(?:-source)?|list-style(?:-image)?|mask(?:-image)?|(?:-webkit-)?mask(?:-image)?|content|cursor)\s*:\s*([^;}]+)/gi;
  for (let declaration = declarations.exec(code); declaration; declaration = declarations.exec(code)) {
    const valueStart = declaration.index + declaration[0].length - declaration[1].length;
    const value = css.slice(valueStart, valueStart + declaration[1].length);
    const urls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi;
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

function collectHtmlLinkTargets(source, parsed, context) {
  const addCssMedia = (css, start) => collectCssMedia(css, start, context);
  const chars = source.split("");
  for (const range of parsed.units.find((unit) => unit.kind === "ejs")?.templateRanges ?? [])
    for (let i = range.start; i < range.end; i++) if (chars[i] !== "\r" && chars[i] !== "\n") chars[i] = " ";
  const html = parseFragment(chars.join(""), { sourceCodeLocationInfo: true }),
    pending = [...html.childNodes];
  while (pending.length) {
    const node = pending.shift();
    if (!node.tagName) continue;
    const locations = firstAttributeLocations(source, node.sourceCodeLocation?.startTag);
    for (const attribute of node.attrs ?? []) {
      const location = locations.get(attribute.prefix ? attribute.prefix + ":" + attribute.name : attribute.name);
      if (location) collectHtmlAttribute(source, node, attribute, location, context);
    }
    if (node.tagName === "style")
      for (const child of node.childNodes ?? [])
        if (child.nodeName === "#text") {
          const location = child.sourceCodeLocation;
          if (location) addCssMedia(source.slice(location.startOffset, location.endOffset), location.startOffset);
        }
    if (node.tagName !== "template") pending.push(...(node.childNodes ?? []));
  }
}

export function collectSourceLinkTargets(source, parsed, context) {
  const { covered, addTarget } = context;
  collectHtmlLinkTargets(source, parsed, context);
  const markdown = /(!?)\[[^\]\r\n]*\]\((https?:\/\/[^\s)]+|\/\/[^\s)]+)(?:\s+"[^"]*")?\)/gi;
  for (let match = markdown.exec(source); match; match = markdown.exec(source)) {
    covered.push({ start: match.index, end: markdown.lastIndex });
    addTarget(match[2], match.index, match[1] ? "media" : "navigation", match[1] ? "markdown.image" : "markdown.link");
  }
  const raw = source.replace(/<%#\s*poem-workshop-meta:v1-start[\s\S]*?poem-workshop-meta:v1-end\s*%>/gi, (value) =>
    value.replace(/[^\r\n]/g, " "),
  );
  for (const item of directUrls(raw))
    if (
      !covered.some((range) => item.index >= range.start && item.index < range.end) &&
      !parsed.units.some((unit) =>
        unit.codeRanges.some((range) => item.index >= range.originalStart && item.index < range.originalEnd),
      )
    ) {
      addTarget(item.url, item.index, "unknown", "resource");
    }
}

function collectHtmlAttribute(source, node, attribute, location, context) {
  const { hints, covered, addTarget } = context;
  if (attribute.name === "style") {
    const rawAttribute = source.slice(location.startOffset, location.endOffset);
    const prefix = /^[^=]+=\s*["']?/.exec(rawAttribute)?.[0].length ?? 0;
    collectCssMedia(rawAttribute.slice(prefix), location.startOffset + prefix, context);
    return;
  }
  if (!["href", "src", "poster", "srcset", "action", "formaction"].includes(attribute.name)) return;
  const media =
    (attribute.name === "src" && ["img", "video", "source", "audio"].includes(node.tagName)) ||
    attribute.name === "poster" ||
    (attribute.name === "srcset" && ["img", "source"].includes(node.tagName));
  const usage = media ? "media" : ["href", "action", "formaction"].includes(attribute.name) ? "navigation" : "unknown";
  if (/<%[=-]?/.test(source.slice(location.startOffset, location.endOffset))) {
    hints.push({
      ruleId: "AH2",
      severity: "hint",
      title: media ? "媒体来源需要人工确认" : "外部目标需要人工确认",
      index: location.startOffset,
      detail: "最终地址由运行时内容决定。",
      suggestion: "请说明最终地址的来源及用途。",
      extra: {
        riskEvidence: { action: node.tagName + "." + attribute.name, usage, target: "dynamic", candidates: [] },
      },
    });
    covered.push({ start: location.startOffset, end: location.endOffset });
    for (const item of directUrls(source.slice(location.startOffset, location.endOffset)))
      addTarget(item.url, location.startOffset + item.index, "unknown", node.tagName + "." + attribute.name);
    return;
  }
  covered.push({ start: location.startOffset, end: location.endOffset });
  if (attribute.name !== "srcset" && external(attribute.value))
    addTarget(attribute.value, location.startOffset, usage, node.tagName + "." + attribute.name);
  else
    for (const item of directUrls(attribute.value))
      addTarget(item.url, location.startOffset, usage, node.tagName + "." + attribute.name);
}
