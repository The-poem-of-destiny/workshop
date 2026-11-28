import { useMemo } from "react";

type ContentToken =
  | { kind: "text"; start: number; value: string }
  | { kind: "ejs-comment"; start: number; value: string }
  | { kind: "ejs-output"; start: number; value: string }
  | { kind: "ejs-code"; start: number; value: string };

const EJS_TAG_RE = /<%[#=_-]?[\s\S]*?[_-]?%>/g;

function tokenizeEjs(content: string): ContentToken[] {
  const tokens: ContentToken[] = [];
  let cursor = 0;
  for (const match of content.matchAll(EJS_TAG_RE)) {
    const start = match.index ?? 0;
    const raw = match[0];
    if (start > cursor) {
      tokens.push({ kind: "text", start: cursor, value: content.slice(cursor, start) });
    }
    const marker = raw[2];
    const kind = marker === "#" ? "ejs-comment" : marker === "=" || marker === "-" ? "ejs-output" : "ejs-code";
    tokens.push({ kind, start, value: raw });
    cursor = start + raw.length;
  }
  if (cursor < content.length) {
    tokens.push({ kind: "text", start: cursor, value: content.slice(cursor) });
  }
  return tokens;
}

export function EjsHighlightedContent({ content }: { content: string }) {
  const tokens = useMemo(() => tokenizeEjs(content), [content]);

  return (
    <div className="preview-ejs-content">
      {tokens.map((token) => {
        if (token.kind === "text") {
          return <span key={`t-${token.start}`}>{token.value}</span>;
        }
        return (
          <code key={`e-${token.start}`} className={`ejs-inline ejs-inline--${token.kind}`}>
            {token.value}
          </code>
        );
      })}
    </div>
  );
}
