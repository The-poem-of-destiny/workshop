import { z } from "zod";

const budgetSchema = z
  .object({
    verified: z.number().nonnegative(),
    hot: z.number().nonnegative(),
    new: z.number().nonnegative(),
    underexposed: z.number().nonnegative(),
  })
  .strict()
  .refine((value) => {
    const sum = Object.values(value).reduce((a, b) => a + b, 0);
    return Number.isFinite(sum) && sum > 0;
  });
const policySchema = z
  .object({
    temperature: z.number().min(0.1).max(4).default(0.7),
    authorCap: z.number().int().min(1).max(24).default(2),
    discoveryLimit: z.number().int().min(1).max(24).default(12),
    budget: budgetSchema.default({ verified: 0.3, hot: 0.25, new: 0.2, underexposed: 0.25 }),
  })
  .strict();
/** Invalid operator configuration fails the batch instead of silently changing scoring. */
export function recommendationPolicy(raw?: string) {
  return policySchema.parse(raw ? JSON.parse(raw) : {});
}
