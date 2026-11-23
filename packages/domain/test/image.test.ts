import { describe, expect, it } from "vitest";
import {
  isJpegFrameMarker,
  PNG_SIGNATURE,
  parseGifHeader,
  parseVp8xHeader,
  parseWebpBitstreamHeader,
  updatePngCrc32,
} from "../src/image.js";

describe("image header helpers", () => {
  it("computes standard PNG CRC32 and recognizes JPEG frame markers", () => {
    expect(PNG_SIGNATURE).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let crc = 0xffffffff;
    for (const byte of [0x49, 0x45, 0x4e, 0x44]) crc = updatePngCrc32(crc, byte);
    expect((crc ^ 0xffffffff) >>> 0).toBe(0xae426082);
    expect(isJpegFrameMarker(0xc0)).toBe(true);
    expect(isJpegFrameMarker(0xc4)).toBe(false);
    expect(isJpegFrameMarker(0xda)).toBe(false);
  });

  it("validates GIF87a/GIF89a header magic and positive dimensions", () => {
    const valid = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x02, 0x00, 0x03, 0x00]);
    expect(parseGifHeader(valid)).toEqual({ width: 2, height: 3, mime: "image/gif" });

    const gif87a = valid.slice();
    gif87a[4] = 0x37;
    expect(parseGifHeader(gif87a)).toEqual({ width: 2, height: 3, mime: "image/gif" });

    const badMagic = valid.slice();
    badMagic[4] = 0x30;
    expect(parseGifHeader(badMagic)).toBeNull();

    const zeroWidth = valid.slice();
    zeroWidth[6] = 0x00;
    expect(parseGifHeader(zeroWidth)).toBeNull();
  });

  it("parses VP8X, VP8, and VP8L (including high-bit unsigned shift) headers", () => {
    const vp8x = Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 2, 0, 0]);
    expect(parseVp8xHeader(vp8x, 10)).toEqual({ width: 2, height: 3, mime: "image/webp" });
    expect(parseVp8xHeader(vp8x, 9)).toBeNull();

    // VP8L with bit 31 set in the 32-bit packed field to exercise unsigned >>> 14 shift.
    const widthMinusOne = 199;
    const heightMinusOne = 299;
    const packed = (widthMinusOne | (heightMinusOne << 14) | 0x80000000) >>> 0;
    const vp8l = new Uint8Array(5);
    vp8l[0] = 0x2f;
    new DataView(vp8l.buffer).setUint32(1, packed, true);
    expect(parseWebpBitstreamHeader("VP8L", vp8l, 5)).toEqual({ width: 200, height: 300, mime: "image/webp" });

    const vp8 = Uint8Array.from([0, 0, 0, 0x9d, 0x01, 0x2a, 0x04, 0x00, 0x05, 0x00]);
    expect(parseWebpBitstreamHeader("VP8 ", vp8, 10)).toEqual({ width: 4, height: 5, mime: "image/webp" });
    expect(parseWebpBitstreamHeader("VP8 ", Uint8Array.from([0, 0, 0, 0, 0, 0, 4, 0, 5, 0]), 10)).toBeNull();
  });
});
