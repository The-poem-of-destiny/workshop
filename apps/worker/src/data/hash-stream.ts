export function hashContentStream(source: ReadableStream<Uint8Array>): {
  body: ReadableStream<Uint8Array>;
  digest: Promise<string>;
} {
  const digest = new crypto.DigestStream("SHA-256");
  void digest.digest.catch(() => {});
  const writer = digest.getWriter();
  const reader = source.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          await writer.close();
          controller.close();
        } else {
          await writer.write(next.value);
          controller.enqueue(next.value);
        }
      } catch (error) {
        await reader.cancel(error).catch(() => {});
        await writer.abort(error).catch(() => {});
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
      await writer.abort(reason).catch(() => {});
    },
  });
  const hash = digest.digest.then((value) =>
    [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
  void hash.catch(() => {});
  return { body, digest: hash };
}
