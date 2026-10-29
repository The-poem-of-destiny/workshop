import { z } from "zod";
import { siteSettingsSchema } from "./admin-dto.js";
import { errorResponseSchema } from "./errors.js";
import { discoveryResponseSchema, projectListResponseSchema } from "./projects.js";

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

const homeSection = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: errorResponseSchema.shape.error }),
  ]);

export const homeResponseSchema = z.object({
  site: homeSection(siteSettingsSchema),
  discovery: homeSection(discoveryResponseSchema),
  projects: homeSection(projectListResponseSchema),
});

export type HomeResponse = z.infer<typeof homeResponseSchema>;
