const coverCacheControl = "public, max-age=0, must-revalidate";

// A reservation carries no user bytes. Its ETag is the capability to write this
// generation. The caller must persist the generation before reserving it and
// must never reserve a generation again after revocation starts.
export function reserveCoverReplica(bucket: R2Bucket, key: string): Promise<R2Object | null> {
  return bucket.put(key, crypto.randomUUID(), {
    onlyIf: new Headers({ "If-None-Match": "*" }),
    httpMetadata: { contentType: "text/plain", cacheControl: "no-store" },
  });
}

export function copyCoverReplica(
  bucket: R2Bucket,
  key: string,
  reservationETag: string,
  bytes: ReadableStream | ArrayBuffer,
  contentType: string,
): Promise<R2Object | null> {
  return bucket.put(key, bytes, {
    onlyIf: { etagMatches: reservationETag },
    httpMetadata: { contentType, cacheControl: coverCacheControl },
  });
}

// The caller must confirm that no reservation PUT for this generation can
// arrive later. An outstanding conditional image PUT is safe: it either lands
// before this deletion or fails its ETag precondition after it.
export function deleteCoverReplica(bucket: R2Bucket, key: string): Promise<void> {
  return bucket.delete(key);
}
