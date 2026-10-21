const encoder = new TextEncoder();

/**
 * Session tokens are random 32-byte values. HMAC with a server secret keeps
 * the stored verifier useless if the D1 dump leaks; plain SHA-256 is retained
 * only for local tests and old rows until a secret is configured.
 */
export async function hashSessionToken(token: string, secret?: string): Promise<string> {
  if (!secret) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
    return toHex(digest);
  }
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(token));
  return toHex(signature);
}

function toHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
