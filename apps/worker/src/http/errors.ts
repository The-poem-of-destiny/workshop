import { ERROR_STATUS, type ErrorCode } from "@workshop/contracts";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function jsonError(c: Context, code: ErrorCode, message: string, details?: unknown) {
  return c.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    ERROR_STATUS[code] as ContentfulStatusCode,
  );
}

export function versionConflict(c: Context, resource: string, expectedVersion: number | null, currentVersion: number) {
  return jsonError(c, "precondition_failed", "Resource version does not match", {
    resource,
    expectedVersion,
    currentVersion,
  });
}
