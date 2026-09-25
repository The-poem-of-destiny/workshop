import { Bool, Num, OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../../types';
import { PROJECT_TYPES } from '../../config/project-taxonomy';
import { projectDb } from '../../utils/db';
import { getCurrentUserFromRequest } from '../../utils/jwt';

const projectListSortSchema = z.enum(['discover', 'published', 'rating', 'updated', 'likes', 'subscribes', 'downloads']);

/**
 * 获取项目列表 (公开 - 只返回已审核通过的项目)
 */
export class ProjectList extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'List Approved Projects',
    request: {
      query: z.object({
        page: Num({ description: 'Page number', default: 0 }),
        pageSize: Num({ description: 'Page size', default: 20 }),
        projectType: z.enum(PROJECT_TYPES).optional().describe('Filter by project type'),
        tag: Str({ required: false }).describe('Filter by tag'),
        tags: Str({ required: false }).describe('Filter by multiple tags (AND, comma-separated)'),
        search: Str({ required: false }).describe('Search keyword'),
        minLikes: z.coerce.number().int().min(0).max(1_000_000).optional().describe('Minimum likes'),
        minDownloads: z.coerce.number().int().min(0).max(1_000_000).optional().describe('Minimum downloads'),
        sort: projectListSortSchema.default('discover').describe('Sort mode'),
      }),
    },
    responses: {
      '200': {
        description: 'Returns project list',
        content: {
          'application/json': {
            schema: z.object({
              success: Bool(),
              hasMore: z.boolean(),
              page: z.number(),
              pageSize: z.number(),
              projects: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  description: z.string().nullable(),
                  version: z.string(),
                  authorId: z.string(),
                  authorName: z.string(),
                  authorGlobalName: z.string(),
                  authorAvatar: z.string().nullable(),
                  downloadUrl: z.string().nullable(),
                  fileSize: z.number().nullable(),
                  downloadsCount: z.number(),
                  hasEjs: z.boolean(),
                  hasCharacterArtwork: z.boolean(),
                  projectType: z.enum(PROJECT_TYPES),
                  extensionType: z.enum(['规则', '内容']).nullable(),
                  facets: z.record(z.array(z.string())),
                  customTags: z.array(z.string()),
                  displayTags: z.array(z.string()),
                  tags: z.array(z.string()),
                  coverImage: z.string().nullable(),
                  likesCount: z.number(),
                  subscribesCount: z.number(),
                  userLiked: z.boolean(),
                  userSubscribed: z.boolean(),
                  createdAt: z.string(),
                  updatedAt: z.string(),
                  latestApprovedAt: z.string().nullable().optional(),
                }),
              ),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { page, pageSize, projectType, tag, tags, search, minLikes, minDownloads, sort } = data.query;
    const payload = await getCurrentUserFromRequest(c);
    const tagFilters = String(tags || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .slice(0, 12);

    const result = await projectDb.list(c, {
      page,
      pageSize,
      approvedOnly: true, // 只返回已审核通过的项目
      projectType,
      tag,
      tags: tagFilters,
      search,
      minLikes,
      minDownloads,
      sort,
      currentUser: payload,
    });

    // 添加作者头像 URL
    const projects = result.projects.map(p => ({
      ...p,
      authorAvatar: p.authorAvatar
        ? `https://cdn.discordapp.com/avatars/${p.authorId}/${p.authorAvatar}.webp?size=100`
        : null,
    }));

    return {
      success: true,
      ...result,
      projects,
    };
  }
}

/**
 * 批量获取指定项目摘要。主要用于本地已安装项目筛选，不读取 R2 项目内容。
 */
export class ProjectBatchFetch extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Get Project Summaries By IDs',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              projectIds: z.array(z.string().min(1)).min(1).max(50),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Returns project summaries for requested IDs' },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const payload = await getCurrentUserFromRequest(c);
    const projectIds = Array.from(new Set(data.body.projectIds.map(value => value.trim()).filter(Boolean))).slice(0, 50);
    const projects = await projectDb.getMany(c, projectIds, payload);

    const visibleProjects = projects.filter(project => {
      if (project.status === 'approved') return true;
      return Boolean(payload && (project.authorId === payload.userId || payload.isAdmin));
    });

    return {
      success: true,
      projects: visibleProjects.map(project => ({
        ...project,
        authorAvatar: project.authorAvatar
          ? `https://cdn.discordapp.com/avatars/${project.authorId}/${project.authorAvatar}.webp?size=100`
          : null,
      })),
    };
  }
}

/**
 * 获取当前用户的所有项目
 */
export class MyProjects extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Get My Projects',
    request: {
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
    },
    responses: {
      '200': {
        description: "Returns user's projects",
      },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projects = await projectDb.getByAuthor(c, payload.userId, payload);

    return {
      success: true,
      projects: projects.map(p => ({
        ...p,
        authorAvatar: p.authorAvatar
          ? `https://cdn.discordapp.com/avatars/${p.authorId}/${p.authorAvatar}.webp?size=100`
          : null,
      })),
    };
  }
}

/**
 * 获取当前用户的项目更新订阅
 */
export class MySubscriptions extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Get My Project Update Subscriptions',
    request: {
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
    },
    responses: {
      '200': { description: "Returns user's subscribed project IDs" },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return {
      success: true,
      projectIds: await projectDb.getSubscribedProjectIds(c, payload.userId),
    };
  }
}
