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
export const authFlowModeSchema = z.enum(["browser", "embed", "device"]);
export type AuthFlowMode = z.infer<typeof authFlowModeSchema>;

export const authFlowCreateSchema = z.object({
  mode: authFlowModeSchema,
  codeChallenge: z.string().min(43).max(128).optional(),
});

export type AuthFlowCreate = z.infer<typeof authFlowCreateSchema>;

export const authFlowResponseSchema = z.object({
  id: z.string().min(1),
  state: z.string().min(1),
  url: z.string().url(),
  expiresAt: z.string().datetime(),
  mode: authFlowModeSchema,
  deviceCode: z.string().min(1).optional(),
});

export type AuthFlowResponse = z.infer<typeof authFlowResponseSchema>;

export const authFlowStatusSchema = z.object({
  status: z.enum(["pending", "authorized", "redeemed", "expired"]),
  expiresAt: z.string().datetime(),
  error: z.string().nullable().optional(),
});

export type AuthFlowStatus = z.infer<typeof authFlowStatusSchema>;

export const authFlowRedeemSchema = z.object({
  verifier: z.string().min(43).max(200).optional(),
  deviceCode: z.string().min(16).max(200).optional(),
  code: z.string().min(16).max(200).optional(),
});
export type AuthFlowRedeem = z.infer<typeof authFlowRedeemSchema>;

export const authSessionResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
  user: meResponseSchema.shape.user,
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export {
  interactionStateItemSchema,
  meStateResponseSchema,
  ratingInputSchema,
} from "./interactions.js";
export type {
  InteractionStateItem,
  MeStateResponse,
  RatingInput,
} from "./interactions.js";
