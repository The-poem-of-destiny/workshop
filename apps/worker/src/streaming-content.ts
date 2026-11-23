import { JSONParser } from "@streamparser/json";
import {
  markWorldbookNames,
  type ProjectContentValidation,
  type ProjectEntryKind,
  validateProjectContent,
  WORKSHOP_LIMITS,
} from "@workshop/domain";

const MAX_NESTING_DEPTH = 64;
const MAX_CONTAINER_ITEMS = 2_500;

class StreamLimitError extends Error {}

export async function validateContentStream(
  body: ReadableStream<Uint8Array>,
  kind: ProjectEntryKind,
  normalize = false,
): Promise<ProjectContentValidation | Response> {
  const parser = new JSONParser();
  let raw: unknown;
  let hasRoot = false;
  let topLevelChildren = 0;
  let entriesChildren = 0;
  parser.onValue = ({ value, stack }) => {
    if (stack.length > MAX_NESTING_DEPTH) {
      throw new StreamLimitError("项目 JSON 嵌套层级超过上限");
    }
    if (stack.length === 1 && ++topLevelChildren > MAX_CONTAINER_ITEMS) {
      throw new StreamLimitError("项目条目数量超过上限（最多 2500 条）");
    }
    if (stack.length === 2 && stack[1]?.key === "entries" && ++entriesChildren > MAX_CONTAINER_ITEMS) {
      throw new StreamLimitError("项目条目数量超过上限（最多 2500 条）");
    }
    if (stack.length === 0) {
      raw = value;
      hasRoot = true;
    }
  };
  const decoder = new TextDecoder();
  let inString = false;
  let escaped = false;
  let depth = 0;
  const write = (chunk: string) => {
    for (const character of chunk) {
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
      } else if (character === '"') inString = true;
      else if (character === "\uFEFF") throw new Error("Unexpected BOM");
      else if (character === "{" || character === "[") {
        if (++depth > MAX_NESTING_DEPTH) {
          throw new StreamLimitError("项目 JSON 嵌套层级超过上限");
        }
      } else if (character === "}" || character === "]") {
        if (depth > 0) depth--;
      }
    }
    parser.write(chunk);
  };
  try {
    // TextDecoder removes one leading BOM, as in the original upload path.
    const reader = body.getReader();
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > WORKSHOP_LIMITS.projectUploadBytes) {
          throw new StreamLimitError("项目文件超过 10 MiB 限制");
        }
        write(decoder.decode(value, { stream: true }));
      }
      write(decoder.decode());
      if (!parser.isEnded) parser.end();
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    if (!hasRoot) throw new Error("Missing JSON root");
  } catch (error) {
    if (error instanceof StreamLimitError) {
      return { valid: false, entryCount: 0, error: error.message };
    }
    return { valid: false, entryCount: 0, error: "项目 JSON 无法解析" };
  }
  const validation = validateProjectContent(raw, kind);
  if (!normalize || !validation.valid) return validation;
  markWorldbookNames(raw);
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  if (bytes.byteLength > WORKSHOP_LIMITS.projectUploadBytes) {
    return { valid: false, entryCount: 0, error: "添加条目名称标记后文件超过 10 MiB 限制" };
  }
  return new Response(bytes, {
    headers: {
      "content-type": "application/json",
      "content-length": String(bytes.byteLength),
      "x-entry-count": String(validation.entryCount),
    },
  });
}
