import { type ProjectEntryKind, validateProjectContentText } from "@workshop/domain";
import { describe, expect, it } from "vitest";
import { validateContentStream } from "../src/streaming-content";

function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

describe("streamed project content", () => {
  it.each([
    ["worldbook", '{"entries":[{"content":"中文\\uD83D\\uDE00"}]}'],
    ["worldbook", '{"entries":[],"entries":[{"content":"last"}]}'],
    ["worldbook", '\uFEFF{"entries":[{"content":"text"}]}'],
    ["worldbook", '\uFEFF\uFEFF{"entries":[{}]}'],
    ["worldbook", '{"entries":[{}]} trailing'],
    ["worldbook", '{"entries":[{}],}'],
    ["worldbook", '{"entries":[{"content":"' + "x".repeat(100_000) + '"}]}'],
    ["regex", '[{"scriptName":"test","findRegex":"/x/g","replaceString":"y"}]'],
  ] as Array<[ProjectEntryKind, string]>)("matches JSON validation across chunk boundaries", async (kind, input) => {
    const bytes = new TextEncoder().encode(input);
    const expected = validateProjectContentText(new TextDecoder().decode(bytes), kind);
    for (const size of bytes.length > 10_000 ? [127, 4096] : [1, 7, 4096]) {
      expect(
        await validateContentStream(chunked(bytes, size), kind),
        `input=${JSON.stringify(input.slice(0, 60))}, chunk=${size}`,
      ).toEqual(expected);
    }
  });
});
