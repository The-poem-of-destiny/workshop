import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ERROR_STATUS, type ErrorCode } from "@workshop/contracts";

export function jsonError(
  c: Context,
  code: ErrorCode,
  message: string,
  details?: unknown,
) {
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
