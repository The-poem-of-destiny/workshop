import { z } from "zod";

// Companion releases are metadata registrations, not Workshop client bundles.
export const companionScriptIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const companionVersionSchema = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/);
export const companionVersionInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    downloadUrl: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        } catch {
          return false;
        }
      }, "A credential-free HTTPS download URL is required"),
  })
  .strict();

export const companionVersionRecordSchema = companionVersionInputSchema.extend({
  scriptId: companionScriptIdSchema,
  version: companionVersionSchema,
  releaseId: z.string().uuid(),
  publishedAt: z.string().datetime(),
});

export type CompanionVersionInput = z.infer<typeof companionVersionInputSchema>;
export type CompanionVersionRecord = z.infer<typeof companionVersionRecordSchema>;
