import { z } from "zod";

export const interactionStateItemSchema = z.object({
  projectId: z.string().min(1),
  liked: z.boolean(),
  subscribed: z.boolean(),
  recommendationEligible: z.boolean(),
  recommendation: z.object({ projectVersionId: z.string().min(1), comment: z.string() }).nullable(),
  rating: z.number().int().min(1).max(5).nullable(),
  comment: z.string().nullable(),
});

export const meStateResponseSchema = z.object({
  items: z.array(interactionStateItemSchema),
});

export type InteractionStateItem = z.infer<typeof interactionStateItemSchema>;
export type MeStateResponse = z.infer<typeof meStateResponseSchema>;

export const ratingInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export type RatingInput = z.infer<typeof ratingInputSchema>;
