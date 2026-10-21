import { z } from "zod";
import { visibilitySchema } from "./identity.js";

export const projectTypeSchema = z.enum(["事件", "系统核心", "角色", "扩展"]);
export type ProjectType = z.infer<typeof projectTypeSchema>;

export const extensionTypeSchema = z.enum(["规则", "内容"]);
export type ExtensionType = z.infer<typeof extensionTypeSchema>;

export const projectSortSchema = z.enum(["updated", "published", "downloads", "likes"]);
export type ProjectSort = z.infer<typeof projectSortSchema>;

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
  entries: z.object({
    worldbook: z.number().int().nonnegative(),
    regex: z.number().int().nonnegative(),
  }),
  schemaVersion: z.string().nullable(),
  versionLabel: z.string().nullable().optional(),
  coverPositionX: z.number().nullable().optional(),
  coverPositionY: z.number().nullable().optional(),
  coverZoom: z.number().nullable().optional(),
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

export const projectDetailSchema = projectSummarySchema.extend({
  authorNote: z.string().nullable(),
  precautions: z.string().nullable().optional(),
  discordThreadUrl: z.string().nullable(),
});

export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const projectListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(512).optional(),
  sort: projectSortSchema.default("updated"),
  projectType: projectTypeSchema.optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export const projectListResponseSchema = z.object({
  items: z.array(projectSummarySchema),
  nextCursor: z.string().nullable(),
});

export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

export const projectEntryIndexSchema = z.object({
  revisionId: z.string(),
  entries: z.array(z.object({
    kind: z.enum(["worldbook", "regex"]),
    entryKey: z.string(),
    name: z.string(),
    contentHash: z.string(),
    contentLength: z.number().int().nonnegative(),
  })),
});

export type ProjectEntryIndex = z.infer<typeof projectEntryIndexSchema>;
