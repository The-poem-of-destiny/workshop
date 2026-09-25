import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../../types';
import { normalizeProjectTaxonomyInput, PROJECT_TYPES } from '../../config/project-taxonomy';
import { generateId, projectDb, userDb } from '../../utils/db';
import { resolveProjectCompatibilitySelection, validateOriginalConflictReferenceItems } from '../../utils/character-reference.ts';
import { getCurrentUserFromRequest } from '../../utils/jwt';
import { LEGACY_PROJECT_VERSION_BASE } from '../../utils/version.js';

/**
 * 创建项目 (需要上传文件)
 */
export class ProjectCreate extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Create New Project',
    request: {
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              name: Str({ description: 'Project name' }),
              description: Str({ required: false }).describe('Project description'),
              versionLabel: z.string().max(80).nullable().optional(),
              builtForReferenceVersionId: z.string().max(120).nullable().optional(),
              compatibilityConfirmed: z.boolean().optional(),
              conflictsWithOriginal: z.boolean().optional(),
              originalConflictReferenceItemIds: z.array(z.string()).max(500).optional(),
              projectType: z.enum(PROJECT_TYPES).optional(),
              extensionType: z.enum(['规则', '内容']).nullable().optional(),
              facets: z.record(z.array(z.string())).optional(),
              customTags: z.array(z.string()).optional(),
              displayTags: z.array(z.string()).optional(),
              tags: z.array(z.string()).default([]),
              coverImage: Str({ required: false }),
            }),
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Returns upload URL',
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const authHeader = c.req.header('authorization');
      if (!authHeader) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const payload = await getCurrentUserFromRequest(c);
      if (!payload) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const rawBody = await c.req.json().catch(() => null);
      if (!rawBody || typeof rawBody !== 'object') {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }

      const name = typeof rawBody.name === 'string' ? rawBody.name.trim() : '';
      const description = typeof rawBody.description === 'string' ? rawBody.description : undefined;
      const rawPrecautions = rawBody.precautions;
      if (rawPrecautions !== undefined && rawPrecautions !== null && typeof rawPrecautions !== 'string') {
        return c.json({ error: '安装注意事项必须是文字' }, 400);
      }
      const precautions = typeof rawPrecautions === 'string' ? rawPrecautions.trim() || null : rawPrecautions;
      if (typeof precautions === 'string' && precautions.length > 2000) {
        return c.json({ error: '安装注意事项最多 2000 字符' }, 400);
      }
      const rawVersionLabel = rawBody.versionLabel;
      if (rawVersionLabel !== undefined && rawVersionLabel !== null && typeof rawVersionLabel !== 'string') {
        return c.json({ error: 'Version label must be text' }, 400);
      }
      const versionLabel = typeof rawVersionLabel === 'string' ? rawVersionLabel.trim() || null : rawVersionLabel;
      const rawBuiltForReferenceVersionId = rawBody.builtForReferenceVersionId;
      if (
        rawBuiltForReferenceVersionId !== undefined
        && rawBuiltForReferenceVersionId !== null
        && typeof rawBuiltForReferenceVersionId !== 'string'
      ) {
        return c.json({ error: '角色卡版本格式不正确，请重新选择' }, 400);
      }
      const builtForReferenceVersionId = typeof rawBuiltForReferenceVersionId === 'string'
        ? rawBuiltForReferenceVersionId.trim() || null
        : rawBuiltForReferenceVersionId;
      const coverImage = typeof rawBody.coverImage === 'string' ? rawBody.coverImage : undefined;

      const taxonomyResult = normalizeProjectTaxonomyInput(rawBody as Record<string, unknown>, {
        requireExtensionSubtypeForExplicitType: false,
      });
      if (!taxonomyResult.value) {
        return c.json({ error: taxonomyResult.error || 'Invalid project taxonomy' }, 400);
      }
      const taxonomy = taxonomyResult.value;

      if (!name) {
        return c.json({ error: 'Project name is required' }, 400);
      }

      if (name.length > 100) {
        return c.json({ error: 'Project name must be 100 characters or fewer' }, 400);
      }
      if (typeof versionLabel === 'string' && versionLabel.length > 80) {
        return c.json({ error: 'Version label must be 80 characters or fewer' }, 400);
      }

      const compatibilityConfirmed = rawBody.compatibilityConfirmed === true;
      const conflictsWithOriginal = rawBody.conflictsWithOriginal === true;
      const requestedConflictItemIds = Array.isArray(rawBody.originalConflictReferenceItemIds)
        ? rawBody.originalConflictReferenceItemIds.map(String)
        : [];

      let compatibilitySelection;
      let originalConflictReferenceItemIds: string[] = [];
      try {
        compatibilitySelection = await resolveProjectCompatibilitySelection(c, {
          builtForReferenceVersionId,
          testedThroughReferenceVersionId: compatibilityConfirmed ? builtForReferenceVersionId : null,
        });
        originalConflictReferenceItemIds = conflictsWithOriginal
          ? await validateOriginalConflictReferenceItems(c, compatibilitySelection.builtForReferenceVersionId, requestedConflictItemIds)
          : [];
        if (conflictsWithOriginal && originalConflictReferenceItemIds.length === 0) {
          return c.json({ error: '请选择需要暂时关闭的原版内容' }, 400);
        }
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : '角色卡版本无效，请重新选择' }, 400);
      }

      const projectId = generateId();
      const existingUser = await userDb.get(c, payload.userId);

      await userDb.upsert(c, {
        id: payload.userId,
        username: payload.username,
        global_name: payload.globalName,
        avatar: payload.avatar || '',
        discriminator: '0000',
        guilds: existingUser?.guilds || [],
        isAdmin: payload.isAdmin,
      });

      await projectDb.create(c, {
        id: projectId,
        name,
        description,
        precautions,
        version: LEGACY_PROJECT_VERSION_BASE,
        versionLabel,
        characterReferenceId: compatibilitySelection.characterReferenceId,
        builtForReferenceVersionId: compatibilitySelection.builtForReferenceVersionId,
        testedThroughReferenceVersionId: compatibilitySelection.testedThroughReferenceVersionId,
        compatibilityStatus: compatibilitySelection.compatibilityStatus,
        compatibilityKnownIncompatible: false,
        compatibilityGraceUntil: compatibilitySelection.compatibilityGraceUntil,
        compatibilityUpdatedAt: compatibilitySelection.builtForReferenceVersionId ? new Date().toISOString() : null,
        conflictsWithOriginal,
        originalConflictReferenceItemIds,
        authorId: payload.userId,
        authorName: payload.username,
        authorAvatar: payload.avatar || '',
        projectType: taxonomy.projectType,
        extensionType: taxonomy.extensionType,
        facets: taxonomy.facets,
        customTags: taxonomy.customTags,
        displayTags: taxonomy.displayTags,
        tags: taxonomy.legacyTags,
        coverImage,
      });

      return {
        success: true,
        projectId,
        message: 'Project created. Please upload the project file using the upload endpoint.',
      };
    } catch (error) {
      console.error('ProjectCreate failed:', error);
      return c.json(
        {
          error: error instanceof Error ? `ProjectCreate failed: ${error.message}` : 'ProjectCreate failed',
        },
        500,
      );
    }
  }
}
