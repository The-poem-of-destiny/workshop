import { z } from "zod";

export const recommendationMetadataSchema = z.object({
  id: z.string(),
  curator: z.object({
    id: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  comment: z.string(),
  projectVersionId: z.string(),
});

export type RecommendationMetadata = z.infer<typeof recommendationMetadataSchema>;
