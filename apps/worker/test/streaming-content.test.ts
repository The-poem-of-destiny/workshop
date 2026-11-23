import { type ProjectEntryKind, validateProjectContentText } from "@workshop/domain";
import { describe, expect, it } from "vitest";
import { streamImage } from "../src/data/streaming-image";
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

  it("aborts early on excessive nesting depth, item count, or byte length", async () => {
    const encoder = new TextEncoder();

    const deep = "[".repeat(65) + "]".repeat(65);
    await expect(validateContentStream(chunked(encoder.encode(deep), 32), "regex")).resolves.toMatchObject({
      valid: false,
      entryCount: 0,
    });

    let pulls = 0;
    const manyItemsStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls === 0) controller.enqueue(encoder.encode('{"entries":[{}'));
        else if (pulls <= 3000) controller.enqueue(encoder.encode(",{}"));
        else controller.close();
        pulls++;
      },
    });
    const manyResult = await validateContentStream(manyItemsStream, "worldbook");
    expect(manyResult).toMatchObject({ valid: false, entryCount: 0 });
    expect(pulls).toBeLessThan(2600);

    let bytePulls = 0;
    const hugeChunk = new Uint8Array(1024 * 1024).fill(32);
    const hugeStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (bytePulls === 0) controller.enqueue(encoder.encode('{"entries":[{"content":"'));
        else controller.enqueue(hugeChunk);
        bytePulls++;
      },
    });
    const hugeResult = await validateContentStream(hugeStream, "worldbook");
    expect(hugeResult).toMatchObject({ valid: false, entryCount: 0 });
    expect(bytePulls).toBeLessThanOrEqual(12);
  });
});

function decodeBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (value) => value.charCodeAt(0));
}

async function consumeStreamImage(bytes: Uint8Array, chunkSize = 3) {
  const { body, result } = streamImage(chunked(bytes, chunkSize), 1024 * 1024);
  const reader = body.getReader();
  while (!(await reader.read()).done) {}
  return result;
}

const sampleImages = [
  {
    mime: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP8ywACLGCSAQANEQED1LYyQAAAAABJRU5ErkJggg==",
  },
  {
    mime: "image/jpeg",
    data: "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjExLjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAACAAIDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z",
  },
  {
    mime: "image/webp",
    data: "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAgA0JaACdLoB+AADsAD+8Oj3/yC5YXXI1/8gP+QH/ID/+PIAAAA=",
  },
  {
    mime: "image/gif",
    data: "R0lGODlhAgACAAAAADs=",
  },
] as const;

describe("streamed image parser invariants", () => {
  it.each(sampleImages)(
    "detects $mime dimensions across small chunks and rejects truncation",
    async ({ mime, data }) => {
      const bytes = decodeBase64(data);
      await expect(consumeStreamImage(bytes, 1)).resolves.toMatchObject({
        bytes: bytes.byteLength,
        dimensions: { width: 2, height: 2, mime },
      });
      await expect(consumeStreamImage(bytes.subarray(0, bytes.length - 1), 2)).resolves.toMatchObject({
        dimensions: null,
      });
    },
  );

  it("enforces PNG checksum, GIF magic/dimensions/trailer, JPEG post-EOI padding, and WebP RIFF/VP8X rules", async () => {
    const png = decodeBase64(sampleImages[0].data);
    new DataView(png.buffer).setUint32(16, 4096);
    await expect(consumeStreamImage(png)).resolves.toMatchObject({ dimensions: null });

    const validGif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x02, 0x00, 0x02, 0x00, 0, 0, 0, 0x3b]);
    await expect(consumeStreamImage(validGif, 2)).resolves.toMatchObject({
      dimensions: { width: 2, height: 2, mime: "image/gif" },
    });
    const badGifMagic = validGif.slice();
    badGifMagic[4] = 0x30;
    await expect(consumeStreamImage(badGifMagic)).resolves.toMatchObject({ dimensions: null });
    const zeroGifWidth = validGif.slice();
    zeroGifWidth[6] = 0x00;
    await expect(consumeStreamImage(zeroGifWidth)).resolves.toMatchObject({ dimensions: null });
    const noGifTrailer = validGif.slice();
    noGifTrailer[noGifTrailer.length - 1] = 0x00;
    await expect(consumeStreamImage(noGifTrailer)).resolves.toMatchObject({ dimensions: null });

    const jpeg = decodeBase64(sampleImages[1].data);
    const paddedJpeg = new Uint8Array(jpeg.length + 2);
    paddedJpeg.set(jpeg);
    paddedJpeg.fill(0xff, jpeg.length);
    await expect(consumeStreamImage(paddedJpeg, 2)).resolves.toMatchObject({
      dimensions: { width: 2, height: 2, mime: "image/jpeg" },
    });
    const polyglotJpeg = new Uint8Array(jpeg.length + 6);
    polyglotJpeg.set(jpeg);
    polyglotJpeg.set([0x3c, 0x73, 0x76, 0x67, 0xff, 0xd9], jpeg.length);
    await expect(consumeStreamImage(polyglotJpeg, 2)).resolves.toMatchObject({ dimensions: null });

    const baseWebp = decodeBase64(sampleImages[2].data);
    const trailingWebp = new Uint8Array(baseWebp.length + 4);
    trailingWebp.set(baseWebp);
    await expect(consumeStreamImage(trailingWebp, 3)).resolves.toMatchObject({ dimensions: null });

    const vp8Payload = baseWebp.subarray(12);
    const junkChunk = Uint8Array.from([0x4a, 0x55, 0x4e, 0x4b, 0x04, 0x00, 0x00, 0x00, 0, 0, 0, 0]);
    const webpWithJunk = new Uint8Array(12 + junkChunk.length + vp8Payload.length);
    webpWithJunk.set(baseWebp.subarray(0, 12), 0);
    webpWithJunk.set(junkChunk, 12);
    webpWithJunk.set(vp8Payload, 12 + junkChunk.length);
    new DataView(webpWithJunk.buffer).setUint32(4, webpWithJunk.length - 8, true);
    await expect(consumeStreamImage(webpWithJunk, 2)).resolves.toMatchObject({
      dimensions: { width: 2, height: 2, mime: "image/webp" },
    });

    const vp8xOnly = new Uint8Array(30);
    vp8xOnly.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 0);
    vp8xOnly.set([0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0], 12);
    await expect(consumeStreamImage(vp8xOnly, 2)).resolves.toMatchObject({ dimensions: null });
  });
});
