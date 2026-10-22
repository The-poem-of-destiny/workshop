import { z } from "zod";

export const referenceItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["worldbook", "regex"]),
  displayName: z.string(),
  exactHash: z.string(),
  normalizedContentHash: z.string(),
  nameHash: z.string(),
  structureHash: z.string(),
});

export type ReferenceItem = z.infer<typeof referenceItemSchema>;

export const referenceVersionSchema = z.object({
  id: z.string(),
  label: z.string(),
  ordinal: z.number().int(),
  graceUntil: z.string(),
  worldbookCount: z.number().int().nonnegative(),
  regexCount: z.number().int().nonnegative(),
  items: z.array(referenceItemSchema).optional(),
});

export type ReferenceVersion = z.infer<typeof referenceVersionSchema>;

export const referenceSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  versions: z.array(referenceVersionSchema),
});

export type ReferenceSet = z.infer<typeof referenceSetSchema>;

export const referenceSetListResponseSchema = z.object({
  items: z.array(referenceSetSchema),
});

export type ReferenceSetListResponse = z.infer<typeof referenceSetListResponseSchema>;
