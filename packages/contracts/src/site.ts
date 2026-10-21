import { z } from "zod";
import { projectSummarySchema } from "./projects.js";

export const bannerSchema = z.object({
  imageUrl: z.string().nullable(),
  positionX: z.number(),
  positionY: z.number(),
  zoom: z.number(),
  mobilePositionX: z.number(),
  mobilePositionY: z.number(),
  mobileZoom: z.number(),
});

export type Banner = z.infer<typeof bannerSchema>;

export const homeResponseSchema = z.object({
  banner: bannerSchema.nullable(),
  latest: z.array(projectSummarySchema),
  recommendations: z.array(projectSummarySchema),
});

export type HomeResponse = z.infer<typeof homeResponseSchema>;
