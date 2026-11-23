import { COLLECTION_LIMITS } from "@workshop/domain";
import { z } from "zod";

export const projectCollectionBadgeSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  projectCount: z.number().int().nonnegative(),
});
export type ProjectCollectionBadge = z.infer<typeof projectCollectionBadgeSchema>;

const collectionAuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});

export const collectionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  author: collectionAuthorSchema,
  projectCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type CollectionSummary = z.infer<typeof collectionSummarySchema>;

export const authorProfileResponseSchema = z.object({
  author: collectionAuthorSchema,
  projectCount: z.number().int().nonnegative(),
  collections: z.array(collectionSummarySchema),
});
export type AuthorProfileResponse = z.infer<typeof authorProfileResponseSchema>;

export const authorCollectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  projectIds: z.array(z.string()),
  publicProjectCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AuthorCollection = z.infer<typeof authorCollectionSchema>;

export const authorCollectionListResponseSchema = z.object({
  items: z.array(authorCollectionSchema),
});
export type AuthorCollectionListResponse = z.infer<typeof authorCollectionListResponseSchema>;

export const createCollectionSchema = z
  .object({
    title: z.string().trim().min(1).max(COLLECTION_LIMITS.title),
    description: z.string().max(COLLECTION_LIMITS.description).default(""),
    projectIds: z
      .array(z.string().trim().min(1).max(80))
      .max(COLLECTION_LIMITS.maxProjectsPerCollection)
      .default([])
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();
export type CreateCollection = z.infer<typeof createCollectionSchema>;

export const patchCollectionSchema = z
  .object({
    title: z.string().trim().min(1).max(COLLECTION_LIMITS.title).optional(),
    description: z.string().max(COLLECTION_LIMITS.description).optional(),
    projectIds: z
      .array(z.string().trim().min(1).max(80))
      .max(COLLECTION_LIMITS.maxProjectsPerCollection)
      .transform((ids) => [...new Set(ids)])
      .optional(),
  })
  .strict();
export type PatchCollection = z.infer<typeof patchCollectionSchema>;

export const projectCollectionsUpdateSchema = z
  .object({
    collectionIds: z
      .array(z.string().trim().min(1).max(80))
      .max(COLLECTION_LIMITS.maxCollectionsPerAuthor)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();
