import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../types';
import { WORKSHOP_LIMITS } from '../config/runtime-limits';
import { projectDb } from '../utils/db';
import { getCurrentUserFromRequest } from '../utils/jwt';
import {
  removeProjectEntryFromJson,
  validateProjectContentText,
  type ProjectEntryKind,
} from '../utils/project-content';
import { parseRegexEntriesPreview, parseWorldbookEntriesPreview, summarizeProjectInspection } from '../utils/project-preview';
import { r2Storage } from '../utils/r2';
import { bumpProjectVersionWithLegacyFallback } from '../utils/version.js';

const MAX_UPLOAD_SIZE = WORKSHOP_LIMITS.projectUploadBytes;
const MAX_COVER_REQUEST_SIZE = MAX_UPLOAD_SIZE + WORKSHOP_LIMITS.coverRequestOverheadBytes;
const UPLOAD_SIZE_ERROR = `文件过大，最大 ${WORKSHOP_LIMITS.projectUploadLabel}`;
async function readPrivateProjectRatingState(
  c: AppContext,
  project: { id: string; authorId: string; status: string; isPublished?: boolean; visibility?: boolean },
  payload: Awaited<ReturnType<typeof getCurrentUserFromRequest>>,
) {
  if (!payload) {
    return { myRating: null, myComment: '', canRate: false, reason: '登录并安装后可评分', summary: null };
  }

  if (project.authorId === payload.userId) {
    const summary = await c.env.DB.prepare(
      `SELECT COUNT(*) AS rating_count,
              AVG(rating) AS average_rating,
              SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS star_1,
              SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) AS star_2,
              SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) AS star_3,
              SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) AS star_4,
              SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS star_5,
              SUM(CASE WHEN comment_text IS NOT NULL AND TRIM(comment_text) <> '' THEN 1 ELSE 0 END) AS comment_count
       FROM project_ratings
       WHERE project_id = ?`,
    )
      .bind(project.id)
      .first<Record<string, number | null>>();
    const comments = await c.env.DB.prepare(
      `SELECT rating, comment_text
       FROM project_ratings
       WHERE project_id = ?
         AND comment_text IS NOT NULL
         AND TRIM(comment_text) <> ''
       ORDER BY updated_at DESC
       LIMIT 20`,
    )
      .bind(project.id)
      .all<{ rating: number; comment_text: string }>();
    const count = Number(summary?.rating_count || 0);
    return {
      myRating: null,
      myComment: '',
      canRate: false,
      reason: '作者可以查看匿名评分统计',
      summary: {
        count,
        average: count > 0 ? Math.round(Number(summary?.average_rating || 0) * 10) / 10 : null,
        commentCount: Number(summary?.comment_count || 0),
        comments: (comments.results || []).map(item => ({
          rating: Number(item.rating || 0),
          comment: String(item.comment_text || ''),
        })),
        distribution: {
          1: Number(summary?.star_1 || 0),
          2: Number(summary?.star_2 || 0),
          3: Number(summary?.star_3 || 0),
          4: Number(summary?.star_4 || 0),
          5: Number(summary?.star_5 || 0),
        },
      },
    };
  }

  const viewerState = await c.env.DB.prepare(
    `SELECT
       (SELECT rating FROM project_ratings WHERE project_id = ?1 AND user_id = ?2) AS my_rating,
       (SELECT comment_text FROM project_ratings WHERE project_id = ?1 AND user_id = ?2) AS my_comment,
       EXISTS(SELECT 1 FROM project_subscribes WHERE project_id = ?1 AND user_id = ?2) AS installed
    `,
  )
    .bind(project.id, payload.userId)
    .first<{ my_rating: number | null; my_comment: string | null; installed: number }>();
  const installed = Number(viewerState?.installed || 0) === 1;
  const projectRateable = project.status === 'approved' && project.isPublished !== false && project.visibility !== false;
  return {
    myRating: viewerState?.my_rating == null ? null : Number(viewerState.my_rating),
    myComment: String(viewerState?.my_comment || ''),
    canRate: installed && projectRateable,
    reason: installed ? (projectRateable ? '' : '这个项目当前不能评分') : '安装这个 DLC 后才能评分',
    summary: null,
  };
}

async function readProjectPreview(
  c: AppContext,
  project: { downloadUrl?: string | null; id: string; publishedProjectId?: string | null },
) {
  const projectObject = await readProjectContentForEdit(c, project, 'worldbook');
  const regexObject = await readProjectContentForEdit(c, project, 'regex');
  const worldbookEntriesPreview = projectObject ? parseWorldbookEntriesPreview(await projectObject.text()) : [];
  const regexEntriesPreview = regexObject ? parseRegexEntriesPreview(await regexObject.text()) : [];
  return { worldbookEntriesPreview, regexEntriesPreview };
}

async function computeProjectInspectionSummary(
  c: AppContext,
  projectId: string,
  overrides: Partial<Record<ProjectEntryKind, string>> = {},
) {
  const project = await projectDb.get(c, projectId);
  if (!project) throw new Error(`Project not found while computing inspection summary: ${projectId}`);

  const readText = async (kind: ProjectEntryKind) => {
    const override = overrides[kind];
    if (override !== undefined) return override;
    const object = await readProjectContentForEdit(c, project, kind);
    return object ? object.text() : null;
  };

  const [worldbookText, regexText] = await Promise.all([readText('worldbook'), readText('regex')]);
  return summarizeProjectInspection(
    worldbookText ? parseWorldbookEntriesPreview(worldbookText) : [],
    regexText ? parseRegexEntriesPreview(regexText) : [],
  );
}

function getProjectContentKey(projectId: string, kind: ProjectEntryKind): string {
  const fileName = kind === 'worldbook' ? `project-${projectId}.json` : `regex-${projectId}.json`;
  return `projects/${projectId}/${fileName}`;
}

async function readProjectContentForEdit(
  c: AppContext,
  project: { id: string; publishedProjectId?: string | null },
  kind: ProjectEntryKind,
) {
  const targetObject = await c.env.R2_BUCKET.get(getProjectContentKey(project.id, kind));
  if (targetObject) return targetObject;
  if (project.publishedProjectId) {
    return c.env.R2_BUCKET.get(getProjectContentKey(project.publishedProjectId, kind));
  }
  return null;
}

export {
  MyProjects,
  MySubscriptions,
  ProjectBatchFetch,
  ProjectList,
} from './projects/read';

/**
 * 获取项目详情
 */
export class ProjectFetch extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Get Project Details',
    request: {
      params: z.object({
        projectId: Str({ description: 'Project ID' }),
      }),
      query: z.object({
        v: Str({ required: false }).describe('Expected project version cache key'),
      }),
    },
    responses: {
      '200': {
        description: 'Returns project details',
      },
      '404': {
        description: 'Project not found',
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;
    const payload = await getCurrentUserFromRequest(c);

    const project = await projectDb.get(c, projectId, payload);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    // 未审核通过的项目只能作者或管理员查看
    if (project.status !== 'approved') {
      let canView = false;

      if (payload) {
        canView = project.authorId === payload.userId || payload.isAdmin;
      }

      if (!canView) {
        return c.json({ error: 'Project not found' }, 404);
      }
    }

    const [preview, privateRating] = await Promise.all([
      readProjectPreview(c, project),
      readPrivateProjectRatingState(c, project, payload),
    ]);

    return {
      success: true,
      project: {
        ...project,
        ...preview,
        privateRating,
        authorAvatar: project.authorAvatar
          ? `https://cdn.discordapp.com/avatars/${project.authorId}/${project.authorAvatar}.webp?size=100`
          : null,
      },
      worldbookEntriesPreview: preview.worldbookEntriesPreview,
      regexEntriesPreview: preview.regexEntriesPreview,
    };
  }
}

export { ProjectRepairResolve } from './projects/repair';

export {
  ProjectCreate,
  ProjectDelete,
  ProjectUpdate,
  ProjectVisibilityUpdate,
} from './projects/write';

/**
 * 上传项目文件
 */
export class ProjectUpload extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Upload Project File',
    request: {
      params: z.object({
        projectId: Str({ description: 'Project ID' }),
      }),
      headers: z.object({
        authorization: z.string().describe('Session ID'),
        'content-type': z.string().describe('File content type'),
      }),
    },
    responses: {
      '200': {
        description: 'Upload successful',
      },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;

    // 检查项目是否存在且属于当前用户
    const project = await projectDb.get(c, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    const contentLengthHeader = c.req.header('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN;

    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    // 获取文件内容
    const arrayBuffer = await c.req.arrayBuffer();
    const contentType = c.req.header('content-type') || 'application/json';

    if (arrayBuffer.byteLength > MAX_UPLOAD_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    // 验证文件类型
    if (!contentType.includes('application/json')) {
      return c.json({ error: 'Only JSON files are allowed' }, 400);
    }

    const worldbookText = new TextDecoder().decode(arrayBuffer);
    const validation = validateProjectContentText(worldbookText, 'worldbook');
    if (validation.valid === false) {
      return c.json({ error: validation.error }, 400);
    }

    if (project.isPublished && project.status === 'approved') {
      const draftId = await projectDb.createDraftFromPublished(c, projectId, {});
      if (!draftId) {
        return c.json({ error: 'Draft creation failed' }, 500);
      }

      const inspectionSummary = await computeProjectInspectionSummary(c, draftId, { worldbook: worldbookText });
      const draftFileName = `project-${draftId}.json`;
      const draftResult = await r2Storage.uploadProjectFile(c, draftId, arrayBuffer, draftFileName, contentType);
      if (!draftResult) {
        return c.json({ error: 'Upload failed' }, 500);
      }

      await projectDb.update(c, draftId, {
        downloadUrl: draftResult.url,
        fileSize: draftResult.size,
        hasEjs: inspectionSummary.hasEjs,
        hasCharacterArtwork: inspectionSummary.hasCharacterArtwork,
        status: 'pending',
      });

      return {
        success: true,
        projectId: draftId,
        downloadUrl: draftResult.url,
        fileSize: draftResult.size,
        message: '草稿版本已提交审核，主页仍显示旧版本。',
      };
    }

    const inspectionSummary = await computeProjectInspectionSummary(c, projectId, { worldbook: worldbookText });
    const fileName = `project-${projectId}.json`;

    // 上传到 R2
    const result = await r2Storage.uploadProjectFile(c, projectId, arrayBuffer, fileName, contentType);
    if (!result) {
      return c.json({ error: 'Upload failed' }, 500);
    }

    const updateData: {
      downloadUrl: string;
      fileSize: number;
      hasEjs: boolean;
      hasCharacterArtwork: boolean;
      status?: string;
    } = {
      downloadUrl: result.url,
      fileSize: result.size,
      hasEjs: inspectionSummary.hasEjs,
      hasCharacterArtwork: inspectionSummary.hasCharacterArtwork,
    };

    await projectDb.update(c, projectId, updateData);
    await projectDb.bumpDraftRevision(c, projectId);

    return {
      success: true,
      downloadUrl: result.url,
      fileSize: result.size,
      message: undefined,
    };
  }
}

export class ProjectCoverUpload extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Upload Project Cover Image',
    request: {
      params: z.object({
        projectId: Str({ description: 'Project ID' }),
      }),
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
    },
    responses: {
      '200': {
        description: 'Cover uploaded successfully',
      },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;

    const project = await projectDb.get(c, projectId, payload);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    const contentLengthHeader = c.req.header('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN;
    if (Number.isFinite(contentLength) && contentLength > MAX_COVER_REQUEST_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    const formData = await c.req.formData();
    const cover = formData.get('cover');

    if (!(cover instanceof File)) {
      return c.json({ error: 'Cover file is required' }, 400);
    }

    if (cover.size > MAX_UPLOAD_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    const contentType = cover.type || 'application/octet-stream';
    const extension =
      contentType === 'image/png'
        ? 'png'
        : contentType === 'image/webp'
          ? 'webp'
          : contentType === 'image/jpeg'
            ? 'jpg'
            : null;

    if (!extension) {
      return c.json({ error: 'Only jpg/png/webp images are allowed' }, 400);
    }

    let targetProjectId = projectId;
    let newlyCreatedDraftId: string | null = null;
    let reusedDraft = false;

    if (project.isPublished && project.status === 'approved') {
      const existingDraft = project.draftProjectId ? await projectDb.get(c, project.draftProjectId, payload) : null;
      const draftId = existingDraft?.id || (await projectDb.createDraftFromPublished(c, projectId, {}));
      if (!draftId) {
        return c.json({ error: 'Draft creation failed' }, 500);
      }
      targetProjectId = draftId;
      reusedDraft = Boolean(existingDraft);
      if (!existingDraft) {
        newlyCreatedDraftId = draftId;
      }
    }

    const key = `projects/${targetProjectId}/cover.${extension}`;
    const uploadResult = await r2Storage.upload(c, key, await cover.arrayBuffer(), contentType);

    if (!uploadResult) {
      if (newlyCreatedDraftId) {
        await projectDb.delete(c, newlyCreatedDraftId);
      }
      return c.json({ error: 'Upload failed' }, 500);
    }

    await projectDb.setCoverImage(c, targetProjectId, key);
    if (reusedDraft) {
      await projectDb.bumpDraftRevision(c, targetProjectId);
    }

    if (targetProjectId !== projectId) {
      return {
        success: true,
        coverImage: uploadResult.url,
        projectId: targetProjectId,
        message: '封面修改已进入审核区，主页仍显示旧版本。',
      };
    }

    await projectDb.bumpDraftRevision(c, projectId);
    return {
      success: true,
      coverImage: uploadResult.url,
    };
  }
}

export { ProjectCoverPresentationUpdate } from './projects/assets';

export {
  ProjectLikeToggle,
  ProjectRatingSet,
  ProjectSubscribeSet,
  ProjectSubscribeToggle,
} from './projects/social';

/**
 * 上传项目正则文件
 */
export class ProjectRegexUpload extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Upload Project Regex File',
    request: {
      params: z.object({
        projectId: Str({ description: 'Project ID' }),
      }),
      headers: z.object({
        authorization: z.string().describe('Session ID'),
        'content-type': z.string().describe('File content type'),
      }),
    },
    responses: {
      '200': {
        description: 'Upload successful',
      },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;

    // 检查项目是否存在且属于当前用户
    const project = await projectDb.get(c, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    const contentLengthHeader = c.req.header('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN;
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    // 获取文件内容
    const arrayBuffer = await c.req.arrayBuffer();
    const contentType = c.req.header('content-type') || 'application/json';

    if (arrayBuffer.byteLength > MAX_UPLOAD_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    // 验证文件类型
    if (!contentType.includes('application/json')) {
      return c.json({ error: 'Only JSON files are allowed' }, 400);
    }

    const regexText = new TextDecoder().decode(arrayBuffer);
    const validation = validateProjectContentText(regexText, 'regex');
    if (validation.valid === false) {
      return c.json({ error: validation.error }, 400);
    }

    let targetProjectId = projectId;
    if (project.isPublished && project.status === 'approved') {
      const draftId = await projectDb.createDraftFromPublished(c, projectId, {});
      if (!draftId) {
        return c.json({ error: 'Draft creation failed' }, 500);
      }
      targetProjectId = draftId;
    }

    const inspectionSummary = await computeProjectInspectionSummary(c, targetProjectId, { regex: regexText });
    const fileName = `regex-${targetProjectId}.json`;

    // 上传到 R2
    const result = await r2Storage.uploadProjectFile(c, targetProjectId, arrayBuffer, fileName, contentType);
    if (!result) {
      return c.json({ error: 'Upload failed' }, 500);
    }
    await projectDb.update(c, targetProjectId, {
      hasEjs: inspectionSummary.hasEjs,
      hasCharacterArtwork: inspectionSummary.hasCharacterArtwork,
    });
    if (!(project.isPublished && project.status === 'approved')) {
      await projectDb.bumpDraftRevision(c, targetProjectId);
    }

    return {
      success: true,
      downloadUrl: result.url,
      fileSize: result.size,
      projectId: targetProjectId,
    };
  }
}

export class ProjectEntryRemove extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Remove One Project Entry',
    request: {
      params: z.object({ projectId: Str({ description: 'Project ID' }) }),
      headers: z.object({ authorization: z.string().describe('Session ID') }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              kind: z.enum(['worldbook', 'regex']),
              entryKey: z.string().min(1),
            }),
          },
        },
      },
    },
    responses: { '200': { description: 'Entry removed' } },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) return c.json({ error: 'Unauthorized' }, 401);

    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;
    const { kind, entryKey } = data.body;
    const project = await projectDb.get(c, projectId, payload);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    let targetProjectId = project.id;
    const existingDraft =
      project.isPublished && project.status === 'approved' && project.draftProjectId
        ? await projectDb.get(c, project.draftProjectId, payload)
        : null;
    const sourceProject =
      project.isPublished && project.status === 'approved'
        ? existingDraft || project
        : project;
    const sourceObject = await readProjectContentForEdit(c, sourceProject, kind as ProjectEntryKind);
    if (!sourceObject) return c.json({ error: 'Project content file not found' }, 404);
    const changed = removeProjectEntryFromJson(await sourceObject.text(), kind as ProjectEntryKind, entryKey);

    if (project.isPublished && project.status === 'approved') {
      const targetVersion = existingDraft?.version || bumpProjectVersionWithLegacyFallback(project.version, 'patch');
      const draftId = await projectDb.createDraftFromPublished(c, project.id, { version: targetVersion });
      if (!draftId) return c.json({ error: 'Draft creation failed' }, 500);
      targetProjectId = draftId;
    }

    const inspectionSummary = await computeProjectInspectionSummary(c, targetProjectId, { [kind]: changed.text });
    const result = await r2Storage.uploadProjectFile(
      c,
      targetProjectId,
      await new Response(changed.text).arrayBuffer(),
      kind === 'worldbook' ? `project-${targetProjectId}.json` : `regex-${targetProjectId}.json`,
      'application/json',
    );
    if (!result) return c.json({ error: 'Upload failed' }, 500);

    if (kind === 'worldbook') {
      await projectDb.update(c, targetProjectId, {
        downloadUrl: result.url,
        fileSize: result.size,
        hasEjs: inspectionSummary.hasEjs,
        hasCharacterArtwork: inspectionSummary.hasCharacterArtwork,
      });
    } else {
      await projectDb.update(c, targetProjectId, {
        hasEjs: inspectionSummary.hasEjs,
        hasCharacterArtwork: inspectionSummary.hasCharacterArtwork,
      });
    }
    if (!(project.isPublished && project.status === 'approved')) {
      await projectDb.bumpDraftRevision(c, targetProjectId);
    }

    if (payload.isAdmin && project.authorId !== payload.userId) {
      await projectDb.logAdminAction(c, {
        action: 'project_entry_removed',
        targetType: project.reviewTarget === 'draft' || project.isPublished ? 'project_draft' : 'project',
        targetId: targetProjectId,
        actorId: payload.userId,
        actorName: payload.globalName || payload.username,
        detail: { kind, entryKey, projectName: project.name },
      });
    }

    return {
      success: true,
      projectId: targetProjectId,
    };
  }
}
