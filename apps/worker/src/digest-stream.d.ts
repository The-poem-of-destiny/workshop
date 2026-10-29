// Matches the DigestStream exposed by the Wrangler-generated Workers runtime types.
interface Crypto {
  readonly DigestStream: typeof DigestStream;
}

declare class DigestStream extends WritableStream<ArrayBuffer | ArrayBufferView> {
  constructor(algorithm: string | AlgorithmIdentifier);
  readonly digest: Promise<ArrayBuffer>;
}
