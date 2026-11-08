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
import { verifyHmac } from './crypto';
import { signingKey, illustrativePreviews } from './env';
import { project } from './db';
import { getPreset } from '../shared/presets';
import { cleanup } from './cleanup';
import { authorizedLocalDevRequest, localBackendOnly } from './dev-operator';
export { ProductionWorkflow, ProductionWorkflow as LiveProductionWorkflow } from './workflow';
export { MediaContainer } from './container';
const app = new Hono<{ Bindings: AppEnv }>();
app.use('*', async (c, next) => {
  if (localBackendOnly(c.env)) {
    const path = c.req.path;
    if (!path.startsWith('/api/') && !path.startsWith('/s/'))
      return c.redirect(
        'PUBLIC_APP_ORIGIN' in c.env ? c.env.PUBLIC_APP_ORIGIN : c.env.APP_ORIGIN,
        302,
      );
    const publicEndpoint =
      path === '/api/health' ||
      path === '/api/fal/webhook' ||
      path.startsWith('/api/inference/') ||
      path.startsWith('/s/');
    if (!publicEndpoint && !(await authorizedLocalDevRequest(c.env, c.req.raw)))
      throw new AppError(403, 'local_dev', 'Use the local development app to access this backend.');
  }
  if (
    ['POST', 'PATCH', 'PUT', 'DELETE'].includes(c.req.method) &&
    c.req.path.startsWith('/api/') &&
    c.req.path !== '/api/fal/webhook'
  )
    validateOrigin(c);
  if (
    c.req.path.startsWith('/api/') &&
    c.req.path !== '/api/fal/webhook' &&
    Number(c.req.header('content-length')) > 15 * 1024 * 1024
  )
    throw new AppError(413, 'size', 'Choose a file smaller than 15 MiB.');
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/s/'))
    c.header('Cache-Control', 'private, no-store');
});
app.get('/api/config', async (c) =>
  c.json({
    mode: c.env.MODE,
    generationEnabled: c.env.MODE === 'mock' || c.env.PAID_GENERATION_ENABLED === 'true',
    previewMode: illustrativePreviews(c.env) ? 'illustrative' : 'generated',
    releaseChannel: 'RELEASE_CHANNEL' in c.env ? c.env.RELEASE_CHANNEL : 'main',
    turnstileSiteKey: 'TURNSTILE_SITE_KEY' in c.env ? c.env.TURNSTILE_SITE_KEY : null,
    localOperatorAccess: await authorizedLocalDevRequest(c.env, c.req.raw),
    maxPeople: 6,
  }),
);
app.get('/api/samples/:preset/:kind', async (c) => {
  const preset = c.req.param('preset');
  const kind = c.req.param('kind');
  if (!['snowball', 'giftwrap', 'danceoff'].includes(preset) || !['video', 'poster'].includes(kind))
    throw new AppError(404, 'sample', 'Sample unavailable.');
  if (illustrativePreviews(c.env))
    return c.env.ASSETS.fetch(
      new Request(
        `${new URL(c.req.url).origin}/fixtures/${preset}${kind === 'video' ? '-3.mp4' : '-poster.jpg'}`,
      ),
    );
  const object = await c.env.MEDIA.get(`samples/${preset}.${kind === 'video' ? 'mp4' : 'jpg'}`);
  if (!object) throw new AppError(404, 'sample', 'Sample unavailable.');
  return new Response(object.body, {
    headers: {
      'content-type': kind === 'video' ? 'video/mp4' : 'image/jpeg',
      'cache-control': 'public, max-age=300',
    },
  });
});
app.get('/api/health', (c) => c.json({ ok: true, mode: c.env.MODE }));
app.route('/api', drafts);
app.route('/api', jobs);
app.route('/', shares);
app.route('/', webhooks);
app.get('/api/inference/:project/music/:preset', async (c) => {
  const p = await project(c.env, c.req.param('project'));
  const expires = c.req.query('expires') ?? '';
  const signature = c.req.query('signature') ?? '';
  if (
    c.req.param('preset') !== p.preset ||
    !/^\d{10}$/.test(expires) ||
    Number(expires) < Date.now() / 1000 ||
    Number(expires) > Date.now() / 1000 + 7201 ||
    !(await verifyHmac(signingKey(c.env), `music:${p.id}:${p.preset}:${expires}`, signature))
  )
    throw new AppError(403, 'music', 'This music authorization has expired.');
  const key = `music/${getPreset(p.preset!).id}.wav`;
  const object = await c.env.MEDIA.get(key);
  if (!object) throw new AppError(404, 'music', 'The music track is unavailable.');
  return new Response(object.body, {
    headers: { 'content-type': 'audio/wav', 'cache-control': 'private, no-store' },
  });
});
app.get('/api/inference/:project/:asset', async (c) => {
  const a = await authorizedInference(
    c.env,
    c.req.param('project'),
    c.req.param('asset'),
    c.req.query('expires') ?? '',
    c.req.query('signature') ?? '',
  );
  return serveAsset(c.env, a, c.req.raw);
});
app.onError((e, c) => {
  if (e instanceof ZodError)
    return c.json(
      {
        code: 'validation',
        message:
          'Check your photos, crops and descriptions. Use 1–6 people, up to 500 characters per description, and one of the three Christmas scenes.',
      },
      400,
    );
  if (e instanceof AppError) {
    if (c.req.path.startsWith('/s/') && ['GET', 'HEAD'].includes(c.req.method))
      return c.html(
        '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cartoon unavailable</title><body style="font:20px system-ui;background:#faf6eb;color:#173e35;padding:12vw"><h1>This cartoon has gone home for the holidays.</h1><p>Its link may have expired or its creator may have removed it.</p><a href="/">Make your own cartoon</a></body></html>',
        404,
      );
    return c.json({ code: e.code, message: e.message }, e.status);
  }
  // Never log provider errors, personal descriptions, source URLs, cookies or request bodies.
  console.error(
    JSON.stringify({ event: 'request_failed', path: c.req.routePath, category: 'internal' }),
  );
  return c.json(
    {
      code: 'internal',
      message: 'The holiday studio hit a snag. Your saved setup is safe. Try again in a moment.',
    },
    503,
  );
});
app.all('/api/*', (c) =>
  c.json({ code: 'not_found', message: 'This action is not available.' }, 404),
);
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));
export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: AppEnv, ctx: ExecutionContext) {
    ctx.waitUntil(cleanup(env));
  },
} satisfies ExportedHandler<AppEnv>;
