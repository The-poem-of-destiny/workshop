import { z } from "zod";

const contributionSchema = z
  .object({
    downloads: z.number().finite(),
    likes: z.number().finite(),
    trend: z.number().finite(),
    freshness: z.number().finite(),
    endorsements: z.number().finite(),
    contentChange: z.number().finite(),
    exposurePressure: z.number().finite().nullable(),
    categoryConfidence: z.number().finite(),
  })
  .strict();
export const recommendationRunResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    scoringVersion: z.literal("four-pool-v1"),
    items: z
      .array(
        z
          .object({
            project_id: z.string().min(1),
            project_version_id: z.string().min(1),
            rank: z.number().int().positive(),
            score: z.number().finite(),
            pool: z.enum(["verified", "hot", "new", "underexposed"]),
            contributions: contributionSchema,
            recommendations: z.array(
              z
                .object({ id: z.string(), user_id: z.string(), comment: z.string(), contribution: z.number().finite() })
                .strict(),
            ),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .superRefine((result, ctx) => {
    const ids = new Set<string>();
    for (const [index, item] of result.items.entries()) {
      if (ids.has(item.project_id) || item.rank !== index + 1) {
        ctx.addIssue({
          code: "custom",
          message: "Projects must be unique and ranks continuous",
          path: ["items", index],
        });
      }
      ids.add(item.project_id);
    }
  });
export type RecommendationRunResult = z.infer<typeof recommendationRunResultSchema>;
