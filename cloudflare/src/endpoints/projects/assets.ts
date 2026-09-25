import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../../types';
import { projectDb } from '../../utils/db';
import { getCurrentUserFromRequest } from '../../utils/jwt';

export class ProjectCoverPresentationUpdate extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Adjust Project Cover Presentation',
    request: {
      params: z.object({ projectId: Str({ description: 'Project ID' }) }),
      headers: z.object({ authorization: z.string().describe('Session ID') }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              coverPositionX: z.number().min(0).max(100),
              coverPositionY: z.number().min(0).max(100),
              coverZoom: z.number().min(1).max(3),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Cover presentation updated' },
      '403': { description: 'Author or admin only' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) return c.json({ error: 'Unauthorized' }, 401);
    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;
    const project = await projectDb.get(c, projectId, payload);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    const presentation = {
      coverPositionX: data.body.coverPositionX,
      coverPositionY: data.body.coverPositionY,
      coverZoom: data.body.coverZoom,
    };
    const linkedId = project.publishedProjectId || project.draftProjectId || null;
    await projectDb.setCoverPresentation(c, [project.id, linkedId || ''], presentation);
    return { success: true, ...presentation };
  }
}
