import { z } from "zod";

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("workshop"),
  version: z.string(),
  bindings: z.object({
    db: z.boolean(),
    r2: z.boolean(),
    assets: z.boolean(),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
