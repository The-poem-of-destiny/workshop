import { z } from "zod";
import { visibilitySchema } from "./identity.js";

export const projectTypeSchema = z.enum(["事件", "系统核心", "角色", "扩展"]);
export type ProjectType = z.infer<typeof projectTypeSchema>;

export const extensionTypeSchema = z.enum(["规则", "内容"]);
export type ExtensionType = z.infer<typeof extensionTypeSchema>;

export const projectSortSchema = z.enum(["updated", "published", "downloads", "likes"]);
export type ProjectSort = z.infer<typeof projectSortSchema>;

export const projectPeriodSchema = z.enum(["all", "7d", "30d", "90d"]);
export type ProjectPeriod = z.infer<typeof projectPeriodSchema>;

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
  authorNote: z.string().nullable().optional(),
  discordThreadUrl: z.string().nullable().optional(),
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
  gallery: z
    .array(z.object({ slot: z.number().int().min(0).max(1), url: z.string() }))
    .max(2)
    .default([]),
  visibility: visibilitySchema,
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
  publishedRevisionId: z.string().nullable().optional(),
});

export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectDetailSchema = projectSummarySchema.extend({
  authorNote: z.string().nullable(),
  precautions: z.string().nullable().optional(),
  discordThreadUrl: z.string().nullable(),
});

export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const projectPreviewKindSchema = z.enum(["worldbook", "regex"]);
export type ProjectPreviewKind = z.infer<typeof projectPreviewKindSchema>;

// Display-only source metadata. Null means the source did not specify a valid value.
export const projectPreviewBehaviorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("worldbook"),
    keys: z.array(z.string()),
    secondaryKeys: z.array(z.string()),
    strategy: z.string().nullable(),
    constant: z.boolean().nullable(),
    selective: z.boolean().nullable(),
    selectiveLogic: z.union([z.string(), z.number().finite()]).nullable(),
    role: z.union([z.string(), z.number().finite()]).nullable(),
    outletName: z.string().nullable(),
    position: z.union([z.string(), z.number().finite()]).nullable(),
    order: z.number().finite().nullable(),
    depth: z.number().finite().nullable(),
    enabled: z.boolean().nullable(),
  }),
  z.object({
    kind: z.literal("regex"),
    scriptName: z.string().nullable(),
    findRegex: z.string().nullable(),
    disabled: z.boolean().nullable(),
    replacementLength: z.number().int().nonnegative().nullable(),
  }),
]);

export const projectPreviewSchema = z.object({
  revisionId: z.string(),
  kind: projectPreviewKindSchema,
  entries: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      content: z.string(),
      behavior: projectPreviewBehaviorSchema.optional(),
    }),
  ),
});

export type ProjectPreview = z.infer<typeof projectPreviewSchema>;

export const projectGalleryResponseSchema = z.object({
  rowVersion: z.number().int().nonnegative(),
  images: z.array(z.object({ slot: z.number().int().min(0).max(1), url: z.string() })),
});

export type ProjectGalleryResponse = z.infer<typeof projectGalleryResponseSchema>;

export const projectListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().max(2048).optional(),
  sort: projectSortSchema.default("updated"),
  // UTC rolling window for likes/downloads; omitted means all-time.
  // Like windows sum transitions (including unlikes of older likes), not active likes.
  period: projectPeriodSchema.optional(),
  projectType: projectTypeSchema.optional(),
  authorId: z.string().trim().min(1).max(64).optional(),
  tag: z.string().trim().min(1).max(60).optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export const projectListResponseSchema = z.object({
  items: z.array(projectSummarySchema),
  nextCursor: z.string().nullable(),
  // Count of the complete filtered set, independent of the current keyset cursor.
  total: z.number().int().nonnegative(),
});

export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

export const projectEntryIndexSchema = z.object({
  revisionId: z.string(),
  entries: z.array(
    z.object({
      kind: z.enum(["worldbook", "regex"]),
      entryKey: z.string(),
      name: z.string(),
      contentHash: z.string(),
      contentLength: z.number().int().nonnegative(),
    }),
  ),
});

export type ProjectEntryIndex = z.infer<typeof projectEntryIndexSchema>;

export const discoveryResponseSchema = z.object({
  bucket: z.string().optional(),
  items: z.array(projectSummarySchema),
});

export type DiscoveryResponse = z.infer<typeof discoveryResponseSchema>;
