import {
  type ImageDimensions,
  isJpegFrameMarker,
  PNG_SIGNATURE,
  parseGifHeader,
  parseVp8xHeader,
  parseWebpBitstreamHeader,
  updatePngCrc32,
} from "@workshop/domain";

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

  write(byte: number) {
    if (this.invalid) return;
    if (this.position < 8) {
      if (byte !== PNG_SIGNATURE[this.position]) this.invalid = true;
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
      for (let i = 4; i < 8; i++) this.crc = updatePngCrc32(this.crc, this.header[i]!);
      this.dataIndex = 0;
      this.crcBytes = 0;
      this.storedCrc = 0;
      if (!this.sawHeader && this.type !== "IHDR") this.invalid = true;
      if (this.type === "IHDR" && (this.sawHeader || this.chunkLength !== 13)) this.invalid = true;
      if (this.type === "IEND" && (this.chunkLength !== 0 || !this.sawHeader)) this.invalid = true;
    }
  }

  private readData(byte: number) {
    this.crc = updatePngCrc32(this.crc, byte);
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
  private state: "signature" | "prefix" | "marker" | "length1" | "length2" | "segment" | "scan" | "scan_ff" | "done" =
    "signature";
  private signatureBytes = 0;
  private marker = 0;
  private length = 0;
  private segmentIndex = 0;
  private width = 0;
  private height = 0;
  private sawFrame = false;
  private invalid = false;

  write(byte: number) {
    if (this.invalid) return;
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
        this.dispatchMarker(byte);
        break;
      case "length1":
        this.length = byte << 8;
        this.state = "length2";
        break;
      case "length2":
        this.length |= byte;
        if (this.length < 2 || (isJpegFrameMarker(this.marker) && this.length < 7)) {
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
        if (byte === 0xff) this.state = "scan_ff";
        break;
      case "scan_ff":
        if (byte === 0xff) break;
        if (byte === 0x00 || (byte >= 0xd0 && byte <= 0xd7)) this.state = "scan";
        else this.dispatchMarker(byte);
        break;
      case "done":
        if (byte !== 0xff) this.invalid = true;
        break;
    }
  }

  private dispatchMarker(byte: number) {
    this.marker = byte;
    if (byte === 0xd9) this.state = "done";
    else if (byte === 0x00 || byte === 0xd8) this.invalid = true;
    else if (byte === 0x01 || (byte >= 0xd0 && byte <= 0xd7)) this.state = "prefix";
    else this.state = "length1";
  }

  private readSegment(byte: number) {
    if (isJpegFrameMarker(this.marker)) {
      if (this.segmentIndex === 3) this.height = byte << 8;
      else if (this.segmentIndex === 4) this.height |= byte;
      else if (this.segmentIndex === 5) this.width = byte << 8;
      else if (this.segmentIndex === 6) this.width |= byte;
    }
    if (++this.segmentIndex === this.length) this.endSegment();
  }

  private endSegment() {
    if (isJpegFrameMarker(this.marker)) {
      if (!this.width || !this.height) this.invalid = true;
      this.sawFrame = true;
    } else if (this.marker === 0xda && !this.sawFrame) {
      this.invalid = true;
    }
    this.state = this.marker === 0xda ? "scan" : "prefix";
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
  private lastByte = -1;

  write(byte: number) {
    if (this.size < this.prefix.length) this.prefix[this.size] = byte;
    this.size++;
    this.lastByte = byte;
  }

  finish(bytes: number): ImageDimensions | null {
    if (bytes < 14 || this.lastByte !== 0x3b) return null;
    return parseGifHeader(this.prefix);
  }
}

class WebpParser implements ImageParser {
  private offset = 0;
  private riffHeader = new Uint8Array(12);
  private riffEnd = 0;
  private paddedRiffEnd = 0;
  private state: "riff" | "chunk_header" | "chunk_data" | "chunk_pad" | "riff_pad" | "done" = "riff";
  private chunkHeader = new Uint8Array(8);
  private chunkHeaderBytes = 0;
  private chunkType = "";
  private chunkSize = 0;
  private chunkIndex = 0;
  private chunkPrefix = new Uint8Array(10);
  private dimensions: ImageDimensions | null = null;
  private sawVp8x = false;
  private sawBitstream = false;
  private invalid = false;

  private anmfState: "header" | "sub_header" | "sub_data" | "sub_pad" = "header";
  private anmfSubHeader = new Uint8Array(8);
  private anmfSubHeaderBytes = 0;
  private anmfSubType = "";
  private anmfSubSize = 0;
  private anmfSubIndex = 0;
  private anmfSubPrefix = new Uint8Array(10);
  private anmfFoundBitstream = false;

  write(byte: number) {
    if (this.invalid) return;
    const pos = this.offset++;
    switch (this.state) {
      case "riff":
        this.readRiffHeader(pos, byte);
        break;
      case "chunk_header":
        this.readChunkHeader(byte);
        break;
      case "chunk_data":
        this.readChunkData(byte);
        break;
      case "chunk_pad":
        this.readChunkPad();
        break;
      case "riff_pad":
        this.state = "done";
        break;
      case "done":
        this.invalid = true;
        break;
    }
  }

  private readRiffHeader(pos: number, byte: number) {
    this.riffHeader[pos] = byte;
    if (pos !== 11) return;
    if (
      String.fromCharCode(...this.riffHeader.subarray(0, 4)) !== "RIFF" ||
      String.fromCharCode(...this.riffHeader.subarray(8, 12)) !== "WEBP"
    ) {
      this.invalid = true;
      return;
    }
    const riffSize = new DataView(this.riffHeader.buffer).getUint32(4, true);
    this.riffEnd = 8 + riffSize;
    this.paddedRiffEnd = this.riffEnd + (riffSize & 1);
    if (this.riffEnd < 20) {
      this.invalid = true;
      return;
    }
    this.state = "chunk_header";
    this.chunkHeaderBytes = 0;
  }

  private readChunkHeader(byte: number) {
    if (this.offset > this.riffEnd) {
      this.invalid = true;
      return;
    }
    this.chunkHeader[this.chunkHeaderBytes++] = byte;
    if (this.chunkHeaderBytes !== 8) return;
    this.chunkType = String.fromCharCode(...this.chunkHeader.subarray(0, 4));
    this.chunkSize = new DataView(this.chunkHeader.buffer).getUint32(4, true);
    const dataEnd = this.offset + this.chunkSize;
    const nextOffset = dataEnd + (this.chunkSize & 1);
    if (dataEnd > this.riffEnd || (dataEnd < this.riffEnd && nextOffset > this.riffEnd)) {
      this.invalid = true;
      return;
    }
    this.chunkIndex = 0;
    if (this.chunkType === "ANMF") {
      if (this.chunkSize < 24) {
        this.invalid = true;
        return;
      }
      this.anmfState = "header";
      this.anmfSubHeaderBytes = 0;
      this.anmfFoundBitstream = false;
    }
    if (this.chunkSize === 0) this.finishChunkPayload();
    else this.state = "chunk_data";
  }

  private readChunkData(byte: number) {
    if (this.chunkType === "VP8X" || this.chunkType === "VP8 " || this.chunkType === "VP8L") {
      if (this.chunkIndex < 10) this.chunkPrefix[this.chunkIndex] = byte;
    } else if (this.chunkType === "ANMF") {
      this.writeAnmfByte(byte);
    }
    this.chunkIndex++;
    if (this.chunkIndex === this.chunkSize) this.finishChunkPayload();
  }

  private readChunkPad() {
    if (this.offset >= this.riffEnd) {
      this.state = this.offset < this.paddedRiffEnd ? "riff_pad" : "done";
    } else {
      this.state = "chunk_header";
      this.chunkHeaderBytes = 0;
    }
  }

  private writeAnmfByte(byte: number) {
    if (this.chunkIndex < 16) {
      if (this.chunkIndex === 15) {
        this.anmfState = "sub_header";
        this.anmfSubHeaderBytes = 0;
      }
      return;
    }
    const remainingInAnmf = this.chunkSize - this.chunkIndex;
    switch (this.anmfState) {
      case "header":
        this.invalid = true;
        break;
      case "sub_header": {
        this.anmfSubHeader[this.anmfSubHeaderBytes++] = byte;
        if (this.anmfSubHeaderBytes === 8) {
          this.anmfSubType = String.fromCharCode(...this.anmfSubHeader.subarray(0, 4));
          this.anmfSubSize = new DataView(this.anmfSubHeader.buffer).getUint32(4, true);
          const afterHeaderRemaining = remainingInAnmf - 1;
          const needPad = this.anmfSubSize < afterHeaderRemaining && (this.anmfSubSize & 1) === 1;
          if (this.anmfSubSize > afterHeaderRemaining || (needPad && this.anmfSubSize + 1 > afterHeaderRemaining)) {
            this.invalid = true;
            return;
          }
          this.anmfSubIndex = 0;
          if (this.anmfSubSize === 0) this.finishAnmfSubChunk(afterHeaderRemaining === 0);
          else this.anmfState = "sub_data";
        }
        break;
      }
      case "sub_data": {
        if ((this.anmfSubType === "VP8 " || this.anmfSubType === "VP8L") && this.anmfSubIndex < 10) {
          this.anmfSubPrefix[this.anmfSubIndex] = byte;
        }
        this.anmfSubIndex++;
        if (this.anmfSubIndex === this.anmfSubSize) this.finishAnmfSubChunk(remainingInAnmf === 1);
        break;
      }
      case "sub_pad":
        this.anmfState = "sub_header";
        this.anmfSubHeaderBytes = 0;
        break;
    }
  }

  private finishAnmfSubChunk(atAnmfEnd: boolean) {
    if (this.anmfSubType === "VP8 " || this.anmfSubType === "VP8L") {
      if (!parseWebpBitstreamHeader(this.anmfSubType, this.anmfSubPrefix, this.anmfSubSize)) {
        this.invalid = true;
        return;
      }
      this.anmfFoundBitstream = true;
    }
    if (!atAnmfEnd && (this.anmfSubSize & 1) === 1) {
      this.anmfState = "sub_pad";
    } else {
      this.anmfState = "sub_header";
      this.anmfSubHeaderBytes = 0;
    }
  }

  private finishChunkPayload() {
    if (this.chunkType === "VP8X") {
      const vp8x = !this.sawVp8x && this.dimensions === null ? parseVp8xHeader(this.chunkPrefix, this.chunkSize) : null;
      if (!vp8x) {
        this.invalid = true;
        return;
      }
      this.sawVp8x = true;
      this.dimensions = vp8x;
    } else if (this.chunkType === "VP8 " || this.chunkType === "VP8L") {
      const parsed = parseWebpBitstreamHeader(this.chunkType, this.chunkPrefix, this.chunkSize);
      if (!parsed) {
        this.invalid = true;
        return;
      }
      this.sawBitstream = true;
      this.dimensions ??= parsed;
    } else if (this.chunkType === "ANMF") {
      if (this.anmfState !== "sub_header" || this.anmfSubHeaderBytes !== 0 || !this.anmfFoundBitstream) {
        this.invalid = true;
        return;
      }
      this.sawBitstream = true;
    }

    if (this.chunkSize & 1) {
      this.state = "chunk_pad";
    } else if (this.offset === this.riffEnd) {
      this.state = this.paddedRiffEnd > this.riffEnd ? "riff_pad" : "done";
    } else {
      this.state = "chunk_header";
      this.chunkHeaderBytes = 0;
    }
  }

  finish(bytes: number): ImageDimensions | null {
    return !this.invalid &&
      bytes >= 20 &&
      (bytes === this.riffEnd || bytes === this.paddedRiffEnd) &&
      (this.state === "done" || this.state === "riff_pad") &&
      this.sawBitstream
      ? this.dimensions
      : null;
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
