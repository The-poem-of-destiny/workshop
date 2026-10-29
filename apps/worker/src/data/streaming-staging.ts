export interface StagedStream {
  bytes: number;
  open(): Promise<ReadableStream<Uint8Array>>;
  copyTo(key: string, options?: R2PutOptions): Promise<void>;
  dispose(): Promise<void>;
}

/** Stage an unknown-length stream without buffering it, then copy its exact range. */
export async function stageStream(
  bucket: R2Bucket,
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
  declaredBytes?: number,
): Promise<StagedStream> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("Invalid staging size");
  const stagingBytes =
    declaredBytes !== undefined && Number.isSafeInteger(declaredBytes) && declaredBytes > 0 && declaredBytes <= maxBytes
      ? declaredBytes
      : maxBytes;
  const key = `tmp/uploads/${crypto.randomUUID()}`;
  const reader = source.getReader();
  const fixed = new FixedLengthStream(stagingBytes);
  const abort = new AbortController();
  let bytes = 0;
  let padding = -1;
  const padded = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (padding < 0) {
        const next = await reader.read();
        if (!next.done) {
          bytes += next.value.byteLength;
          if (bytes > stagingBytes) throw new RangeError("Upload exceeds staging size");
          controller.enqueue(next.value);
          return;
        }
        padding = stagingBytes - bytes;
      }
      if (padding === 0) {
        controller.close();
        return;
      }
      const size = Math.min(padding, 65536);
      padding -= size;
      controller.enqueue(new Uint8Array(size));
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
  const pipe = padded.pipeTo(fixed.writable, { signal: abort.signal });
  const upload = bucket.put(key, fixed.readable);
  try {
    const [, stored] = await Promise.all([pipe, upload]);
    if (!stored) throw new Error("Staging upload was not stored");
  } catch (error) {
    abort.abort(error);
    await Promise.allSettled([pipe, upload]);
    await bucket.delete(key);
    throw error;
  }
  return {
    bytes,
    async open() {
      if (bytes === 0)
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        });
      const object = await bucket.get(key, { range: { offset: 0, length: bytes } });
      if (!object) throw new Error("Staged upload not found");
      return object.body;
    },
    async copyTo(destination, options) {
      if (bytes === 0) throw new Error("Cannot copy an empty staged upload");
      const object = await bucket.get(key, { range: { offset: 0, length: bytes } });
      if (!object) throw new Error("Staged upload not found");
      const body = object.body;
      const exact = new FixedLengthStream(bytes);
      const controller = new AbortController();
      const copy = body.pipeTo(exact.writable, { signal: controller.signal });
      const put = bucket.put(destination, exact.readable, options);
      try {
        const [, stored] = await Promise.all([copy, put]);
        if (!stored) throw new Error("Upload was not stored");
      } catch (error) {
        controller.abort(error);
        await Promise.allSettled([copy, put]);
        throw error;
      }
    },
    async dispose() {
      await bucket.delete(key);
    },
  };
}
