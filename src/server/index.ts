import { Hono } from 'hono';
import { ZodError } from 'zod';
import type { AppEnv } from './env';
import { drafts } from './drafts';
import { jobs } from './jobs';
import { shares } from './shares';
import { webhooks } from './webhook';
import { validateOrigin } from './auth';
import { AppError } from './errors';
import { authorizedInference, serveAsset } from './media';
import { cleanup } from './cleanup';
export { ProductionWorkflow } from './workflow';
export { MediaContainer } from './container';
const app = new Hono<{ Bindings: AppEnv }>();
app.use('*', async (c, next) => {
 if (['POST','PATCH','PUT','DELETE'].includes(c.req.method) && c.req.path.startsWith('/api/') && c.req.path !== '/api/fal/webhook') validateOrigin(c);
 if (c.req.path.startsWith('/api/') && c.req.path !== '/api/fal/webhook' && Number(c.req.header('content-length')) > 15 * 1024 * 1024) throw new AppError(413, 'size', 'Choose a file smaller than 15 MiB.');
 await next();
 c.header('X-Content-Type-Options', 'nosniff'); c.header('Referrer-Policy', 'same-origin');
 c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
 if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/s/')) c.header('Cache-Control', 'private, no-store');
});
app.get('/api/config', c => c.json({ mode: c.env.MODE, turnstileSiteKey: 'TURNSTILE_SITE_KEY' in c.env ? c.env.TURNSTILE_SITE_KEY : null, maxPeople: 6 }));
app.get('/api/health', c => c.json({ ok: true, mode: c.env.MODE }));
app.route('/api', drafts); app.route('/api', jobs); app.route('/', shares); app.route('/', webhooks);
app.get('/api/inference/:project/:asset', async c => {
 const a = await authorizedInference(c.env, c.req.param('project'), c.req.param('asset'), c.req.query('expires') ?? '', c.req.query('signature') ?? '');
 return serveAsset(c.env, a, c.req.raw);
});
app.onError((e, c) => {
 if (e instanceof ZodError) return c.json({ code: 'validation', message: 'Check your photos, crops and descriptions. Use 1–6 people, up to 500 characters per description, and one of the three Christmas scenes.' }, 400);
 if (e instanceof AppError) {
  if (c.req.path.startsWith('/s/')) return c.html('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cartoon unavailable</title><body style="font:20px system-ui;background:#faf6eb;color:#173e35;padding:12vw"><h1>This cartoon has gone home for the holidays.</h1><p>Its link may have expired or its creator may have removed it.</p><a href="/">Make your own cartoon</a></body></html>', 404);
  return c.json({ code: e.code, message: e.message }, e.status);
 }
 // Never log provider errors, personal descriptions, source URLs, cookies or request bodies.
 console.error(JSON.stringify({ event: 'request_failed', path: c.req.routePath, category: 'internal' }));
 return c.json({ code: 'internal', message: 'The holiday studio hit a snag. Your saved setup is safe. Try again in a moment.' }, 503);
});
app.all('/api/*', c => c.json({ code: 'not_found', message: 'This action is not available.' }, 404));
app.all('*', c => c.env.ASSETS.fetch(c.req.raw));
export default {
 fetch: app.fetch,
 async scheduled(_controller: ScheduledController, env: AppEnv, ctx: ExecutionContext) { ctx.waitUntil(cleanup(env)); },
} satisfies ExportedHandler<AppEnv>;
