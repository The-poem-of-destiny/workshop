import { app } from "./app";
import type { Env } from "./env";
import { runScheduled } from "./scheduler";

export { ContentService } from "./content-service";

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<Env>;
