import { type ReactNode, useMemo } from "react";
import { keyedItems } from "./keyedItems";

/**
 * Renders a deliberately small, safe Markdown subset:
 * paragraphs, line breaks, headings (#..###), bold, italic, inline code,
 * fenced code blocks, bullet/numbered lists, block quotes and http(s) links.
 * Everything is produced as React elements — no HTML parsing — so HTML tags
 * stay visible as text and unsupported link schemes are never made clickable.
 */

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; level: number; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string };

const URL_TERMINATORS: Record<string, true> = {
  " ": true,
  "\t": true,
  "\n": true,
  "\r": true,
  "<": true,
  ">": true,
  '"': true,
  "'": true,
  "`": true,
};
const TRAILING_PUNCTUATION = ".,;:!?，。；：！？、";

function externalUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function trimBareUrl(value: string): string {
  let candidate = value;
  while (candidate && TRAILING_PUNCTUATION.includes(candidate[candidate.length - 1] ?? "")) {
    candidate = candidate.slice(0, -1);
  }
  while (candidate.endsWith(")") && candidate.split(")").length > candidate.split("(").length) {
    candidate = candidate.slice(0, -1);
  }
  return candidate;
}

function ExternalAnchor({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return (
    <a className="md-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="md-external-mark" aria-hidden="true">
        ↗
      </span>
      <span className="sr-only">（外部链接）</span>
    </a>
  );
}

type InlineToken = { node: ReactNode; end: number };

function inlineLink(text: string, index: number, keyBase: string, depth: number): InlineToken | null {
  if (text[index] === "[") {
    const labelEnd = text.indexOf("](", index + 1);
    const close = labelEnd >= 0 ? text.indexOf(")", labelEnd + 2) : -1;
    if (labelEnd > index + 1 && close > labelEnd + 2) {
      const href = externalUrl(text.slice(labelEnd + 2, close));
      if (href) {
        const key = `${keyBase}-link-${index}`;
        return {
          node: (
            <span key={key}>
              <ExternalAnchor href={href}>
                {renderInline(text.slice(index + 1, labelEnd), key, depth + 1, false)}
              </ExternalAnchor>
            </span>
          ),
          end: close + 1,
        };
      }
    }
  }
  if (text[index] !== "h" || (!text.startsWith("http://", index) && !text.startsWith("https://", index))) return null;
  let end = index;
  while (end < text.length && !URL_TERMINATORS[text[end] ?? ""]) end += 1;
  const candidate = trimBareUrl(text.slice(index, end));
  const href = externalUrl(candidate);
  if (!href) {
    const runEnd = Math.max(end, index + 1);
    return { node: text.slice(index, runEnd), end: runEnd };
  }
  return {
    node: (
      <span key={`${keyBase}-url-${index}`}>
        <ExternalAnchor href={href}>{candidate}</ExternalAnchor>
      </span>
    ),
    end: index + Math.max(candidate.length, 1),
  };
}

function inlineEmphasis(
  text: string,
  index: number,
  keyBase: string,
  depth: number,
  allowLinks: boolean,
): InlineToken | null {
  const character = text[index] ?? "";
  if (character !== "*" && character !== "_") return null;
  if (character === "_" && index > 0 && /[\p{L}\p{N}]/u.test(text[index - 1] ?? "")) return null;
  const pair = character + character;
  if (text.startsWith(pair, index)) {
    const strongEnd = text.indexOf(pair, index + 2);
    const strongInner = strongEnd >= 0 ? text.slice(index + 2, strongEnd) : "";
    if (strongEnd > index + 2 && strongInner.trim() === strongInner) {
      const key = `${keyBase}-strong-${index}`;
      return {
        node: <strong key={key}>{renderInline(strongInner, key, depth + 1, allowLinks)}</strong>,
        end: strongEnd + 2,
      };
    }
  }
  const emphasisEnd = text.indexOf(character, index + 1);
  const emphasisInner = emphasisEnd >= 0 ? text.slice(index + 1, emphasisEnd) : "";
  if (emphasisEnd > index + 1 && emphasisInner.trim() === emphasisInner) {
    const key = `${keyBase}-em-${index}`;
    return {
      node: <em key={key}>{renderInline(emphasisInner, key, depth + 1, allowLinks)}</em>,
      end: emphasisEnd + 1,
    };
  }
  return null;
}

function renderInline(text: string, keyBase: string, depth = 0, allowLinks = true): ReactNode[] {
  if (depth > 6) return [text];
  const nodes: ReactNode[] = [];
  let index = 0;
  let plain = "";

  const flush = (): void => {
    if (!plain) return;
    nodes.push(plain);
    plain = "";
  };

  while (index < text.length) {
    const character = text[index] ?? "";

    if (character === "`") {
      const close = text.indexOf("`", index + 1);
      if (close > index + 1) {
        flush();
        nodes.push(
          <code className="md-inline-code" key={`${keyBase}-code-${index}`}>
            {text.slice(index + 1, close)}
          </code>,
        );
        index = close + 1;
        continue;
      }
    }

    const token =
      (allowLinks ? inlineLink(text, index, keyBase, depth) : null) ??
      inlineEmphasis(text, index, keyBase, depth, allowLinks);
    if (token) {
      if (typeof token.node === "string") plain += token.node;
      else {
        flush();
        nodes.push(token.node);
      }
      index = token.end;
      continue;
    }

    plain += character;
    index += 1;
  }

  flush();
  return nodes;
}

function renderLines(lines: string[], keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  keyedItems(lines).forEach(({ item: line, key }, lineIndex) => {
    if (lineIndex > 0) nodes.push(<br key={`${keyBase}-br-${key}`} />);
    for (const node of renderInline(line, `${keyBase}-line-${key}`)) nodes.push(node);
  });
  return nodes;
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    blocks.push({ kind: "paragraph", lines: paragraph });
    paragraph = [];
  };
  const flushQuote = (): void => {
    if (!quote.length) return;
    blocks.push({ kind: "quote", lines: quote });
    quote = [];
  };
  const flushList = (): void => {
    if (!list) return;
    blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  const flushText = (): void => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const line of lines) {
    if (code) {
      if (/^\s*```/.test(line)) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushText();
      code = [];
      continue;
    }
    if (!line.trim()) {
      flushText();
      continue;
    }

    const heading = /^\s*(#{1,3})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading) {
      flushText();
      blocks.push({ kind: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
      continue;
    }

    const quoteMatch = /^\s*>\s?(.*)$/u.exec(line);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1] ?? "");
      continue;
    }
    flushQuote();

    const unordered = /^\s*[-*+]\s+(.+)$/u.exec(line);
    if (unordered) {
      flushParagraph();
      if (list?.ordered) flushList();
      list = list ?? { ordered: false, items: [] };
      list.items.push(unordered[1] ?? "");
      continue;
    }

    const ordered = /^\s*\d{1,9}[.)]\s+(.+)$/u.exec(line);
    if (ordered) {
      flushParagraph();
      if (list && !list.ordered) flushList();
      list = list ?? { ordered: true, items: [] };
      list.items.push(ordered[1] ?? "");
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  flushText();
  return blocks;
}

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.kind) {
    case "paragraph":
      return <p key={key}>{renderLines(block.lines, key)}</p>;
    case "heading": {
      const Heading = block.level >= 2 ? "h5" : "h4";
      return (
        <Heading key={key} className={`md-heading md-heading-${block.level}`}>
          {renderInline(block.text, key)}
        </Heading>
      );
    }
    case "quote":
      return (
        <blockquote key={key} className="md-quote">
          <p>{renderLines(block.lines, key)}</p>
        </blockquote>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List key={key} className="md-list">
          {keyedItems(block.items).map(({ item, key: itemKey }) => (
            <li key={`${key}-item-${itemKey}`}>{renderInline(item, `${key}-item-${itemKey}`)}</li>
          ))}
        </List>
      );
    }
    case "code":
      return (
        <pre key={key} className="md-code-block">
          <code>{block.text}</code>
        </pre>
      );
  }
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={className ? `markdown ${className}` : "markdown"}>
      {keyedItems(blocks).map(({ item: block, key }) => renderBlock(block, key))}
    </div>
  );
}
