import { describe, expect, it } from "vitest";
import { detectImageDimensions } from "./image.js";

describe("image dimensions", () => {
  it("reads a PNG header", () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    ]);
    expect(detectImageDimensions(bytes)).toEqual({ width: 1, height: 1, mime: "image/png" });
  });

  it("rejects unknown or truncated data", () => {
    expect(detectImageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(detectImageDimensions(new Uint8Array(24))).toBeNull();
  });
});
