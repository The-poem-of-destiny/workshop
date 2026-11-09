import { z } from "zod";

export const requirementTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("project"),
      projectId: z.string().min(1).max(80),
      versionConstraint: z.string().trim().max(200).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("original-entry"),
      entryKind: z.enum(["worldbook", "regex"]),
      key: z.string().min(1).max(1000),
      name: z.string().max(500).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("external"), text: z.string().trim().min(1).max(2000) }).strict(),
]);

export const recommendedTargetSchema = z
  .object({
    target: requirementTargetSchema,
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const requirementsSchema = z
  .object({
    schemaVersion: z.literal(1),
    dependencies: z.array(requirementTargetSchema).max(100),
    conflicts: z
      .array(z.object({ target: requirementTargetSchema, mode: z.enum(["conflict", "override"]) }).strict())
      .max(100),
    // Optional for existing records; recommendations never block installation.
    recommended: z.array(recommendedTargetSchema).max(50).optional(),
    notes: z.string().max(2000),
  })
  .strict();
export type Requirements = z.infer<typeof requirementsSchema>;
