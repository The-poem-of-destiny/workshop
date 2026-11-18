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
  policyAccepted: z.boolean().optional(),
});

export type Session = z.infer<typeof sessionSchema>;

export const userPolicyStateSchema = z.object({
  currentVersion: z.string().min(1),
  acceptedVersion: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  accepted: z.boolean(),
});

export type UserPolicyState = z.infer<typeof userPolicyStateSchema>;

export const policyAcceptanceInputSchema = z
  .object({
    version: z.string().trim().min(1).max(64),
    agreed: z.literal(true),
    answers: z.record(z.string().min(1).max(64), z.string().min(1).max(64)),
  })
  .strict();

export type PolicyAcceptanceInput = z.infer<typeof policyAcceptanceInputSchema>;

export const policyAcceptanceResponseSchema = z.object({
  policy: userPolicyStateSchema,
});

export type PolicyAcceptanceResponse = z.infer<typeof policyAcceptanceResponseSchema>;

export const meResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    username: z.string(),
    globalName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    role: roleSchema,
  }),
  policy: userPolicyStateSchema,
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

export type {
  ExperienceNote,
  ExperienceNoteInput,
  ExperienceNotesResponse,
  ExperienceNoteVersion,
  InteractionStateItem,
  MeStateResponse,
} from "./interactions.js";
export {
  experienceNoteInputSchema,
  experienceNoteSchema,
  experienceNotesResponseSchema,
  experienceNoteVersionSchema,
  interactionStateItemSchema,
  meStateResponseSchema,
} from "./interactions.js";
