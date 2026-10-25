import { describe, expect, it } from "vitest";
import { detectImageDimensions } from "./image.js";

function decodeImage(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (value) => value.charCodeAt(0));
}

// Real 2x2 red images encoded by FFmpeg, including compressed pixel data.
const images = [
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
];

describe("image dimensions", () => {
  it.each(images)("reads dimensions from a complete $mime image", ({ mime, data }) => {
    expect(detectImageDimensions(decodeImage(data))).toEqual({ width: 2, height: 2, mime });
  });

  it.each(images)("rejects a truncated $mime image", ({ data }) => {
    const bytes = decodeImage(data);
    expect(detectImageDimensions(bytes.subarray(0, bytes.length - 1))).toBeNull();
  });

  it("rejects PNG dimensions altered without a matching checksum", () => {
    const bytes = decodeImage(images[0]!.data);
    new DataView(bytes.buffer).setUint32(16, 4096);
    expect(detectImageDimensions(bytes)).toBeNull();
  });

  it("rejects unknown or truncated headers", () => {
    expect(detectImageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(detectImageDimensions(new Uint8Array(24))).toBeNull();
  });
});
