import { z } from "zod";

export const roleSchema = z.enum(["member", "reviewer", "owner"]);
export type Role = z.infer<typeof roleSchema>;

export const visibilitySchema = z.enum(["public", "private"]);
export type Visibility = z.infer<typeof visibilitySchema>;

export const sessionSchema = z.object({
  userId: z.string().min(1),
  role: roleSchema,
  sessionVersion: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
});

export type Session = z.infer<typeof sessionSchema>;

export const meResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    username: z.string(),
    globalName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    role: roleSchema,
  }),
});

export type MeResponse = z.infer<typeof meResponseSchema>;
