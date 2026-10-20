import { z } from "zod";
import { projectSummarySchema } from "./projects.js";

export const recommendationSchema = z.object({
  id: z.string(),
  curator: z.object({
    id: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  comment: z.string(),
  reaction: z.string(),
  project: projectSummarySchema,
});

export type Recommendation = z.infer<typeof recommendationSchema>;

export const recommendationListResponseSchema = z.object({
  items: z.array(recommendationSchema),
});

export type RecommendationListResponse = z.infer<typeof recommendationListResponseSchema>;
