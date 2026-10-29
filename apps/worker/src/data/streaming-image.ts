import type { ImageDimensions } from "@workshop/domain";

export class UploadLimitError extends Error {
  constructor() {
    super("Upload exceeds byte limit");
    this.name = "UploadLimitError";
  }
}

export interface StreamingImageResult {
  bytes: number;
  sha256: string;
  dimensions: ImageDimensions | null;
}

interface ImageParser {
  write(byte: number): void;
  finish(bytes: number): ImageDimensions | null;
}
const jpegFrameMarkers = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf];

class PngParser implements ImageParser {
  private position = 0;
  private header = new Uint8Array(8);
  private headerBytes = 0;
  private remaining = 0;
  private chunkLength = 0;
  private type = "";
  private crc = 0xffffffff;
  private storedCrc = 0;
  private crcBytes = 0;
  private dataIndex = 0;
  private width = 0;
  private height = 0;
  private sawHeader = false;
  private ended = false;
  private invalid = false;

  private updateCrc(byte: number) {
    this.crc ^= byte;
    for (let bit = 0; bit < 8; bit++) this.crc = (this.crc >>> 1) ^ (this.crc & 1 ? 0xedb88320 : 0);
  }

  write(byte: number) {
    if (this.invalid) return;
    if (this.position < 8) {
      if (byte !== [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][this.position]) this.invalid = true;
      this.position++;
      return;
    }
    if (this.ended) {
      this.invalid = true;
      return;
    }
    if (this.headerBytes < 8) this.readHeader(byte);
    else if (this.remaining > 0) this.readData(byte);
    else this.readCrc(byte);
  }

  private readHeader(byte: number) {
    this.header[this.headerBytes++] = byte;
    if (this.headerBytes === 8) {
      this.chunkLength = new DataView(this.header.buffer).getUint32(0);
      this.remaining = this.chunkLength;
      this.type = String.fromCharCode(...this.header.subarray(4));
      this.crc = 0xffffffff;
      for (let i = 4; i < 8; i++) this.updateCrc(this.header[i]!);
      this.dataIndex = 0;
      this.crcBytes = 0;
      this.storedCrc = 0;
      if (this.type === "IHDR" && (this.sawHeader || this.chunkLength !== 13)) this.invalid = true;
      if (this.type === "IEND" && (this.chunkLength !== 0 || !this.sawHeader)) this.invalid = true;
    }
  }

  private readData(byte: number) {
    this.updateCrc(byte);
    if (this.type === "IHDR") {
      if (this.dataIndex < 4) this.width = (this.width * 256 + byte) >>> 0;
      else if (this.dataIndex < 8) this.height = (this.height * 256 + byte) >>> 0;
    }
    this.dataIndex++;
    this.remaining--;
  }

  private readCrc(byte: number) {
    this.storedCrc = (this.storedCrc * 256 + byte) >>> 0;
    if (++this.crcBytes === 4) {
      if ((this.crc ^ 0xffffffff) >>> 0 !== this.storedCrc) this.invalid = true;
      if (this.type === "IHDR") {
        if (!this.width || !this.height) this.invalid = true;
        this.sawHeader = true;
      }
      if (this.type === "IEND") this.ended = true;
      this.headerBytes = 0;
    }
  }

  finish(): ImageDimensions | null {
    return !this.invalid && this.sawHeader && this.ended
      ? { width: this.width, height: this.height, mime: "image/png" }
      : null;
  }
}

class JpegParser implements ImageParser {
  private state: "signature" | "prefix" | "marker" | "length1" | "length2" | "segment" | "scan" | "done" = "signature";
  private signatureBytes = 0;
  private marker = 0;
  private length = 0;
  private segmentIndex = 0;
  private width = 0;
  private height = 0;
  private sawFrame = false;
  private previous = 0;
  private invalid = false;

  write(byte: number) {
    if (this.invalid || this.state === "done") return;
    switch (this.state) {
      case "signature":
        if (byte !== (this.signatureBytes === 0 ? 0xff : 0xd8)) this.invalid = true;
        if (++this.signatureBytes === 2) this.state = "prefix";
        break;
      case "prefix":
        if (byte !== 0xff) this.invalid = true;
        else this.state = "marker";
        break;
      case "marker":
        if (byte === 0xff) break;
        this.marker = byte;
        if (byte === 0xd9) this.state = "done";
        else if (byte === 0x01 || (byte >= 0xd0 && byte <= 0xd8)) this.state = "prefix";
        else this.state = "length1";
        break;
      case "length1":
        this.length = byte << 8;
        this.state = "length2";
        break;
      case "length2":
        this.length |= byte;
        if (this.length < 2 || (this.isFrame() && this.length < 7)) {
          this.invalid = true;
          break;
        }
        this.segmentIndex = 2;
        if (this.length === 2) this.endSegment();
        else this.state = "segment";
        break;
      case "segment":
        this.readSegment(byte);
        break;
      case "scan":
        if (this.previous === 0xff && byte === 0xd9) this.state = "done";
        this.previous = byte;
        break;
    }
  }

  private readSegment(byte: number) {
    if (this.isFrame()) {
      if (this.segmentIndex === 3) this.height = byte << 8;
      else if (this.segmentIndex === 4) this.height |= byte;
      else if (this.segmentIndex === 5) this.width = byte << 8;
      else if (this.segmentIndex === 6) this.width |= byte;
    }
    if (++this.segmentIndex === this.length) this.endSegment();
  }

  private isFrame() {
    return jpegFrameMarkers.includes(this.marker);
  }

  private endSegment() {
    if (this.isFrame()) {
      if (!this.width || !this.height) this.invalid = true;
      this.sawFrame = true;
    }
    this.state = this.marker === 0xda ? "scan" : "prefix";
    this.previous = 0;
  }

  finish(): ImageDimensions | null {
    return !this.invalid && this.state === "done" && this.sawFrame && this.width > 0 && this.height > 0
      ? { width: this.width, height: this.height, mime: "image/jpeg" }
      : null;
  }
}

class GifParser implements ImageParser {
  private prefix = new Uint8Array(10);
  private size = 0;

  write(byte: number) {
    if (this.size < this.prefix.length) this.prefix[this.size] = byte;
    this.size++;
  }

  finish(): ImageDimensions | null {
    const p = this.prefix;
    if (this.size < 10 || p[0] !== 0x47 || p[1] !== 0x49 || p[2] !== 0x46) return null;
    return { width: p[6]! | (p[7]! << 8), height: p[8]! | (p[9]! << 8), mime: "image/gif" };
  }
}

class WebpParser implements ImageParser {
  private prefix = new Uint8Array(30);
  private size = 0;
  write(byte: number) {
    if (this.size < this.prefix.length) this.prefix[this.size] = byte;
    this.size++;
  }
  finish(bytes: number): ImageDimensions | null {
    const p = this.prefix;
    if (
      bytes < 20 ||
      String.fromCharCode(...p.subarray(0, 4)) !== "RIFF" ||
      String.fromCharCode(...p.subarray(8, 12)) !== "WEBP"
    )
      return null;
    const view = new DataView(p.buffer);
    const riffEnd = 8 + view.getUint32(4, true);
    const chunkSize = view.getUint32(16, true);
    if (riffEnd > bytes || riffEnd < 20 || 20 + chunkSize + (chunkSize & 1) > riffEnd) return null;
    const chunk = String.fromCharCode(...p.subarray(12, 16));
    let width: number;
    let height: number;
    if (chunk === "VP8X" && chunkSize >= 10) {
      width = 1 + (p[24]! | (p[25]! << 8) | (p[26]! << 16));
      height = 1 + (p[27]! | (p[28]! << 8) | (p[29]! << 16));
    } else if (chunk === "VP8L" && chunkSize >= 5 && p[20] === 0x2f) {
      const bits = p[21]! | (p[22]! << 8) | (p[23]! << 16) | (p[24]! << 24);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >> 14) & 0x3fff);
    } else if (chunk === "VP8 " && chunkSize >= 10 && p[23] === 0x9d && p[24] === 0x01 && p[25] === 0x2a) {
      width = (p[26]! | (p[27]! << 8)) & 0x3fff;
      height = (p[28]! | (p[29]! << 8)) & 0x3fff;
    } else return null;
    return width > 0 && height > 0 ? { width, height, mime: "image/webp" } : null;
  }
}

/** Consume the returned stream once; result resolves only after the entire source is consumed. */
export function streamImage(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
): {
  body: ReadableStream<Uint8Array>;
  result: Promise<StreamingImageResult>;
} {
  const digest = new crypto.DigestStream("SHA-256");
  void digest.digest.catch(() => {});
  const writer = digest.getWriter();
  let parser: ImageParser | null | undefined;
  let bytes = 0;
  let resolve!: (result: StreamingImageResult) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<StreamingImageResult>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  void result.catch(() => {});
  const reader = source.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          await writer.close();
          const hash = await digest.digest;
          resolve({
            bytes,
            sha256: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join(""),
            dimensions: parser?.finish(bytes) ?? null,
          });
          controller.close();
          return;
        }
        bytes += next.value.byteLength;
        if (bytes > maxBytes) throw new UploadLimitError();
        for (const byte of next.value) {
          if (parser === undefined)
            parser =
              byte === 0x89
                ? new PngParser()
                : byte === 0xff
                  ? new JpegParser()
                  : byte === 0x52
                    ? new WebpParser()
                    : byte === 0x47
                      ? new GifParser()
                      : null;
          parser?.write(byte);
        }
        await writer.write(next.value);
        controller.enqueue(next.value);
      } catch (error) {
        await reader.cancel(error).catch(() => {});
        await writer.abort(error).catch(() => {});
        reject(error);
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
      await writer.abort(reason).catch(() => {});
      reject(reason ?? new Error("Upload stream cancelled"));
    },
  });
  return { body, result };
}
