import { z } from "zod";

export const interactionStateItemSchema = z.object({
  projectId: z.string().min(1),
  liked: z.boolean(),
  subscribed: z.boolean(),
});

export const meStateResponseSchema = z.object({
  items: z.array(interactionStateItemSchema),
});

export type InteractionStateItem = z.infer<typeof interactionStateItemSchema>;
export type MeStateResponse = z.infer<typeof meStateResponseSchema>;

export const experienceNoteInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export const experienceNoteSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const experienceNoteVersionSchema = z.object({
  projectVersionId: z.string().min(1),
  versionNo: z.number().int().positive(),
  versionLabel: z.string().nullable(),
  isCurrent: z.boolean(),
  note: experienceNoteSchema.nullable(),
});

export const experienceNotesResponseSchema = z.object({
  projectId: z.string().min(1),
  versions: z.array(experienceNoteVersionSchema),
  unversionedNote: experienceNoteSchema.nullable(),
});

export type ExperienceNoteInput = z.infer<typeof experienceNoteInputSchema>;
export type ExperienceNote = z.infer<typeof experienceNoteSchema>;
export type ExperienceNoteVersion = z.infer<typeof experienceNoteVersionSchema>;
export type ExperienceNotesResponse = z.infer<typeof experienceNotesResponseSchema>;
