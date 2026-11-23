export interface ImageDimensions {
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}

export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function updatePngCrc32(crc: number, byte: number): number {
  let next = crc ^ byte;
  for (let bit = 0; bit < 8; bit += 1) next = (next >>> 1) ^ (next & 1 ? 0xedb88320 : 0);
  return next >>> 0;
}

export function isJpegFrameMarker(marker: number): boolean {
  return JPEG_FRAME_MARKERS.has(marker);
}

export function parseGifHeader(prefix: Uint8Array): ImageDimensions | null {
  if (
    prefix.length < 10 ||
    prefix[0] !== 0x47 ||
    prefix[1] !== 0x49 ||
    prefix[2] !== 0x46 ||
    prefix[3] !== 0x38 ||
    (prefix[4] !== 0x37 && prefix[4] !== 0x39) ||
    prefix[5] !== 0x61
  ) {
    return null;
  }
  const width = prefix[6]! | (prefix[7]! << 8);
  const height = prefix[8]! | (prefix[9]! << 8);
  return width > 0 && height > 0 ? { width, height, mime: "image/gif" } : null;
}

export function parseVp8xHeader(prefix: Uint8Array, chunkSize: number): ImageDimensions | null {
  if (chunkSize < 10 || prefix.length < 10) return null;
  const width = 1 + (prefix[4]! | (prefix[5]! << 8) | (prefix[6]! << 16));
  const height = 1 + (prefix[7]! | (prefix[8]! << 8) | (prefix[9]! << 16));
  return width > 0 && height > 0 ? { width, height, mime: "image/webp" } : null;
}

export function parseWebpBitstreamHeader(chunk: string, prefix: Uint8Array, chunkSize: number): ImageDimensions | null {
  if (chunk === "VP8L") {
    if (chunkSize < 5 || prefix.length < 5 || prefix[0] !== 0x2f) return null;
    const bits = (prefix[1]! | (prefix[2]! << 8) | (prefix[3]! << 16) | (prefix[4]! << 24)) >>> 0;
    const width = 1 + (bits & 0x3fff);
    const height = 1 + ((bits >>> 14) & 0x3fff);
    return width > 0 && height > 0 ? { width, height, mime: "image/webp" } : null;
  }
  if (chunk === "VP8 ") {
    if (chunkSize < 10 || prefix.length < 10 || prefix[3] !== 0x9d || prefix[4] !== 0x01 || prefix[5] !== 0x2a) {
      return null;
    }
    const width = (prefix[6]! | (prefix[7]! << 8)) & 0x3fff;
    const height = (prefix[8]! | (prefix[9]! << 8)) & 0x3fff;
    return width > 0 && height > 0 ? { width, height, mime: "image/webp" } : null;
  }
  return null;
}
