import { z } from "zod";
import { visibilitySchema } from "./identity.js";

export const projectTypeSchema = z.enum(["事件", "系统核心", "角色", "扩展"]);
export type ProjectType = z.infer<typeof projectTypeSchema>;

export const extensionTypeSchema = z.enum(["规则", "内容"]);
export type ExtensionType = z.infer<typeof extensionTypeSchema>;

export const projectSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  author: z.object({
    id: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  projectType: projectTypeSchema.nullable(),
  extensionType: extensionTypeSchema.nullable(),
  tags: z.array(z.string()),
  counts: z.object({
    downloads: z.number().int().nonnegative(),
    likes: z.number().int().nonnegative(),
    subscriptions: z.number().int().nonnegative(),
  }),
  coverUrl: z.string().nullable(),
  visibility: visibilitySchema,
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectListResponseSchema = z.object({
  items: z.array(projectSummarySchema),
  nextCursor: z.string().nullable(),
});

export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

export const pageQuerySchema = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;
