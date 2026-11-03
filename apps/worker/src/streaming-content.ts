import { JSONParser } from "@streamparser/json";
import {
  markWorldbookNames,
  type ProjectContentValidation,
  type ProjectEntryKind,
  validateProjectContent,
  WORKSHOP_LIMITS,
} from "@workshop/domain";

export async function validateContentStream(
  body: ReadableStream<Uint8Array>,
  kind: ProjectEntryKind,
  normalize = false,
): Promise<ProjectContentValidation | Response> {
  const parser = new JSONParser();
  let raw: unknown;
  let hasRoot = false;
  parser.onValue = ({ value, stack }) => {
    if (stack.length === 0) {
      raw = value;
      hasRoot = true;
    }
  };
  const decoder = new TextDecoder();
  let inString = false;
  let escaped = false;
  const write = (chunk: string) => {
    for (const character of chunk) {
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
      } else if (character === '"') inString = true;
      else if (character === "\uFEFF") throw new Error("Unexpected BOM");
    }
    parser.write(chunk);
  };
  try {
    // TextDecoder removes one leading BOM, as in the original upload path.
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
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
  } catch {
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
