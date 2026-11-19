const TOKEN_KEY = "cw_session_token";
let sessionGeneration = 0;
const sessionListeners = new Set<() => void>();

export function getSessionGeneration(): number {
  return sessionGeneration;
}

export function subscribeSessionChange(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

function token(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function hasSessionToken(): boolean {
  return Boolean(token());
}

export function setSessionToken(value: string | null): void {
  const previous = token();
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sandboxed iframe */
  }
  if (previous !== token()) {
    sessionGeneration += 1;
    for (const listener of sessionListeners) listener();
  }
}

export function authHeaders(): Record<string, string> {
  const value = token();
  return value ? { authorization: `Bearer ${value}` } : {};
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: unknown;

  constructor(status: number, statusText: string, code: string | null, message: string, details: unknown) {
    super(`${status} ${code ? `${code}: ` : ""}${message || statusText}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function requestJson<T>(path: string, init: RequestInit = {}, publicRead = false): Promise<T> {
  const response = await fetch(path, {
    ...init,
    ...(publicRead ? { credentials: "omit" as const } : {}),
    headers: { accept: "application/json", ...(publicRead ? {} : authHeaders()), ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    let message = "";
    let code: string | null = null;
    let details: unknown;
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && !Array.isArray(body)) {
        if ("message" in body && typeof body.message === "string") message = body.message;
        if ("error" in body && typeof body.error === "object" && body.error !== null && !Array.isArray(body.error)) {
          if ("message" in body.error && typeof body.error.message === "string") message = body.error.message;
          if ("code" in body.error && typeof body.error.code === "string") code = body.error.code;
          if ("details" in body.error) details = body.error.details;
        }
      }
    } catch {
      /* non-json error */
    }
    throw new ApiError(response.status, response.statusText, code, message, details);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function jsonRequest<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  return requestJson<T>(path, {
    method,
    headers: { "content-type": "application/json", ...(extraHeaders ?? {}) },
    body: JSON.stringify(body),
  });
}

export async function requestBlob(url: string): Promise<Blob> {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.blob();
}

export async function requestText(url: string): Promise<string> {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}
