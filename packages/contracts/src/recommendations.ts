import { z } from "zod";
import { projectSummarySchema } from "./projects.js";
import { recommendationMetadataSchema } from "./recommendation-metadata.js";

export const recommendationSchema = recommendationMetadataSchema.extend({ project: projectSummarySchema });

export type Recommendation = z.infer<typeof recommendationSchema>;

export const recommendationListResponseSchema = z.object({
  items: z.array(recommendationSchema),
});

export type RecommendationListResponse = z.infer<typeof recommendationListResponseSchema>;
