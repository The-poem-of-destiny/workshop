export interface ImageDimensions {
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index]!;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 33 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  )
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const storedCrc = view.getUint32(dataEnd);
    if (crc32(bytes, offset + 4, dataEnd) !== storedCrc) return null;
    if (type === "IHDR") {
      if (sawHeader || length !== 13) return null;
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      if (width === 0 || height === 0) return null;
      sawHeader = true;
    } else if (type === "IEND") {
      if (length !== 0 || !sawHeader) return null;
      sawEnd = true;
      if (end !== bytes.length) return null;
      break;
    }
    offset = end;
  }
  return sawHeader && sawEnd ? { width, height, mime: "image/png" } : null;
}

// Scan entropy-coded data for the end marker without treating its bytes as segments.
function hasJpegEndMarker(bytes: Uint8Array, offset: number): boolean {
  for (let index = offset; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) return true;
  }
  return false;
}

// Segment lengths include their own two-byte field, but not the marker.
function jpegSegmentLength(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) return 0;
  const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
  return length >= 2 && offset + length <= bytes.length ? length : 0;
}

function jpeg(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawFrame = false;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++]!;
    if (marker === 0xd9) return sawFrame && width > 0 && height > 0 ? { width, height, mime: "image/jpeg" } : null;
    if (marker === 0xda) {
      const length = jpegSegmentLength(bytes, offset);
      if (length === 0) return null;
      offset += length;
      return hasJpegEndMarker(bytes, offset) && sawFrame && width > 0 && height > 0
        ? { width, height, mime: "image/jpeg" }
        : null;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const length = jpegSegmentLength(bytes, offset);
    if (length === 0) return null;
    const isFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isFrame) {
      if (length < 7) return null;
      height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      if (width === 0 || height === 0) return null;
      sawFrame = true;
    }
    offset += length;
  }
  return null;
}

function gif(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null;
  return {
    width: bytes[6]! | (bytes[7]! << 8),
    height: bytes[8]! | (bytes[9]! << 8),
    mime: "image/gif",
  };
}

function webp(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 20 ||
    String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP"
  )
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > bytes.length || riffEnd < 20) return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  const chunkSize = view.getUint32(16, true);
  const chunkEnd = 20 + chunkSize + (chunkSize & 1);
  if (chunkEnd > riffEnd) return null;
  if (chunk === "VP8X") {
    if (chunkSize < 10) return null;
    const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    return width > 0 && height > 0 ? { width, height, mime: "image/webp" } : null;
  }
  if (chunk === "VP8L") {
    if (chunkSize < 5 || bytes[20] !== 0x2f) return null;
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    const width = 1 + (bits & 0x3fff);
    const height = 1 + ((bits >> 14) & 0x3fff);
    return width > 0 && height > 0 ? { width, height, mime: "image/webp" } : null;
  }
  if (chunk === "VP8 ") {
    if (chunkSize < 10 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = (bytes[26]! | (bytes[27]! << 8)) & 0x3fff;
    const height = (bytes[28]! | (bytes[29]! << 8)) & 0x3fff;
    return width > 0 && height > 0 ? { width, height, mime: "image/webp" } : null;
  }
  return null;
}

export function detectImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  return png(bytes) ?? jpeg(bytes) ?? gif(bytes) ?? webp(bytes);
}
