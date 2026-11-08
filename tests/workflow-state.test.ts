import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import type { AppEnv } from '../src/server/env';
import { reserve } from '../src/server/budget';
import { prepareAttempt, claimSubmission, produceArtifact } from '../src/server/attempts';
import type { WorkflowStep } from 'cloudflare:workers';
import { recordCallback } from '../src/server/webhook';
import { cleanup } from '../src/server/cleanup';
import type { MediaInput } from '../src/server/fal';
import { project, view } from '../src/server/db';
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch(){return new Response("ok")} }',
    compatibilityDate: '2026-11-07',
    d1Databases: ['DB'],
    r2Buckets: ['MEDIA'],
  }),
);
let env: AppEnv;
const owner = 'test-owner';
const id = 'test-project';
const media: MediaInput = {
  kind: 'video',
  input: {
    prompt: 'A tiny shimmy. No dialogue.',
    frameUrl: 'https://example.test/frame',
    referenceUrls: [],
    seed: 1,
  },
};
beforeAll(async () => {
  const bindings = await mf.getBindings<AppEnv>();
  const { DB, MEDIA } = bindings;
  const files = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const migration = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    for (const sql of migration
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await DB.prepare(sql).run();
  }
  env = {
    ...bindings,
    DB,
    MEDIA,
    MODE: 'mock',
    MAX_JOB_COST_USD: '0.05',
    DAILY_BUDGET_USD: '0.1',
    MAX_PROVIDER_CONCURRENCY: '2',
    VIDEO_COST_USD: '0.01',
    IMAGE_COST_USD: '0.01',
    VIDEO_MODEL: 'minimax/h3-max/reference-to-video',
    IMAGE_MODEL: 'openai/gpt-image-2.6/flare/edit',
  };
}, 20000);
afterAll(() => mf.dispose());
beforeEach(async () => {
  const stored = await env.MEDIA.list();
  if (stored.objects.length) await env.MEDIA.delete(stored.objects.map((o) => o.key));
  await env.DB.batch(
    [
      'webhook_inbox',
      'reservations',
      'attempts',
      'shots',
      'shares',
      'renders',
      'characters',
      'upload_tickets',
      'assets',
      'events',
      'projects',
      'sessions',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)')
    .bind(owner, 'hash', now, now + 86400000)
    .run();
  await env.DB.prepare(
    "INSERT INTO projects(id,owner_id,network_hash,seed,state,created_at,updated_at,expires_at) VALUES(?,?,?,1,'queued',?,?,?)",
  )
    .bind(id, owner, 'net', now, now, now + 86400000)
    .run();
});
it('atomically enforces job and account budgets under simultaneous reservations, with idempotent replay', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) => reserve(env, id, `budget-${i}`, 10000)),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
  const rows = await env.DB.prepare('SELECT * FROM reservations').all<{ id: string }>();
  await Promise.all(rows.results.map((r) => reserve(env, id, r.id, 10000)));
  expect(
    (
      await env.DB.prepare('SELECT SUM(amount_micros) AS n FROM reservations').first<{
        n: number;
      }>()
    )?.n,
  ).toBe(50000);
  const other = 'other-project';
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO projects(id,owner_id,network_hash,seed,state,created_at,updated_at,expires_at) VALUES(?,?,?,1,'queued',?,?,?)",
  )
    .bind(other, owner, 'net', now, now, now + 86400000)
    .run();
  const second = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) =>
      reserve({ ...env, MAX_JOB_COST_USD: '1' }, other, `account-${i}`, 10000),
    ),
  );
  expect(second.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
});
it('deduplicates callback-before-save, ignores conflicting and deleted callbacks, and consumes no retry', async () => {
  const a = await prepareAttempt(env, id, 'clip-1', 0, media);
  expect(await claimSubmission(env, a)).toBe(true);
  const callback = {
    request_id: 'fal-request',
    status: 'OK' as const,
    payload: { video: { url: 'https://v3.fal.media/a.mp4' } },
  };
  await recordCallback(env, a.id, callback);
  await recordCallback(env, a.id, callback);
  await recordCallback(env, a.id, { ...callback, request_id: 'wrong-request' });
  const saved = await env.DB.prepare('SELECT request_id,state FROM attempts WHERE id=?')
    .bind(a.id)
    .first<{ request_id: string; state: string }>();
  expect(saved).toEqual({ request_id: 'fal-request', state: 'queued' });
  expect(
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM webhook_inbox').first<{ n: number }>())?.n,
  ).toBe(1);
  expect(
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM attempts').first<{ n: number }>())?.n,
  ).toBe(1);
  await env.DB.prepare("UPDATE projects SET state='deleted' WHERE id=?").bind(id).run();
  const b = { ...callback, request_id: 'late-request' };
  await recordCallback(env, a.id, b);
  expect(
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM webhook_inbox').first<{ n: number }>())?.n,
  ).toBe(1);
});
it('counts unknown submissions against concurrency and never reclaims a paid submission', async () => {
  const a = await prepareAttempt(env, id, 'clip-1', 0, media);
  expect(await claimSubmission(env, a)).toBe(true);
  await env.DB.prepare("UPDATE attempts SET state='submission_unknown' WHERE id=?")
    .bind(a.id)
    .run();
  expect(await claimSubmission(env, a)).toBe(false);
  const b = await prepareAttempt(env, id, 'clip-2', 0, media);
  expect(await claimSubmission(env, b)).toBe(true);
  const c = await prepareAttempt(env, id, 'clip-3', 0, media);
  expect(await claimSubmission(env, c)).toBe(false);
});

it('durably stores only normalized callback moderation codes, including early and duplicate deliveries', async () => {
  const a = await prepareAttempt(env, id, 'clip-1', 0, media);
  await claimSubmission(env, a);
  const callback = {
    request_id: 'blocked-receipt',
    status: 'ERROR' as const,
    error: {
      detail: [
        {
          type: 'content_policy_violation',
          categories: ['model_moderated'],
          msg: 'private text and signed URL',
        },
      ],
    },
  };
  await recordCallback(env, a.id, callback);
  await recordCallback(env, a.id, { ...callback, error: 'different duplicate' });
  const saved = await env.DB.prepare('SELECT payload FROM webhook_inbox WHERE request_id=?')
    .bind(callback.request_id)
    .first<{ payload: string }>();
  expect(JSON.parse(saved!.payload)).toEqual({
    category: 'content_policy_violation:model_moderated',
  });
  expect(saved!.payload).not.toContain('private text');
  const category = JSON.parse(saved!.payload).category;
  await env.DB.prepare("UPDATE projects SET state='failed',error_code=? WHERE id=?")
    .bind(category, id)
    .run();
  const response = await view(env, await project(env, id));
  expect(response.errorCode).toBe('content_policy_violation:model_moderated');
  expect(response.error).toContain('content_policy_violation; model_moderated');
  expect(
    await env.DB.prepare('SELECT request_id FROM attempts WHERE id=?')
      .bind(a.id)
      .first('request_id'),
  ).toBe(callback.request_id);
});
it('enforces one video repair across all shots', async () => {
  await prepareAttempt(env, id, 'clip-1', 0, media);
  await prepareAttempt(env, id, 'clip-1', 1, media);
  await expect(prepareAttempt(env, id, 'clip-2', 1, media)).rejects.toThrow();
  const replay = await prepareAttempt(env, id, 'clip-1', 1, media);
  expect(replay.revision).toBe(1);
});
it('cleans expired sources while finished playback objects and shares retain independent lifetimes', async () => {
  const now = Date.now();
  await env.DB.prepare("UPDATE projects SET state='ready',expires_at=? WHERE id=?")
    .bind(now + 30 * 86400000, id)
    .run();
  for (const [asset, kind, expiry] of [
    ['source', 'source', now - 1],
    ['video', 'video', now + 30 * 86400000],
    ['poster', 'poster', now + 30 * 86400000],
  ] as const) {
    await env.MEDIA.put(`${id}/${asset}`, 'fixture');
    await env.DB.prepare(
      'INSERT INTO assets(id,project_id,kind,r2_key,mime,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
    )
      .bind(asset, id, kind, `${id}/${asset}`, 'test', now, expiry)
      .run();
  }
  await cleanup(env);
  expect(await env.MEDIA.head(`${id}/source`)).toBeNull();
  expect(await env.MEDIA.head(`${id}/video`)).toBeTruthy();
  expect(await env.MEDIA.head(`${id}/poster`)).toBeTruthy();
  expect(
    (
      await env.DB.prepare('SELECT state FROM projects WHERE id=?')
        .bind(id)
        .first<{ state: string }>()
    )?.state,
  ).toBe('ready');
});

it('advances through cleanup batches instead of repeatedly deleting the first 200 rows', async () => {
  const now = Date.now();
  await env.DB.prepare("UPDATE projects SET state='ready',expires_at=? WHERE id=?")
    .bind(now + 86400000, id)
    .run();
  const rows = Array.from({ length: 201 }, (_, i) => ({
    id: `expired-${i}`,
    key: `${id}/expired-${i}`,
  }));
  await Promise.all(rows.map((row) => env.MEDIA.put(row.key, 'expired fixture')));
  for (let offset = 0; offset < rows.length; offset += 40)
    await env.DB.batch(
      rows
        .slice(offset, offset + 40)
        .map((row) =>
          env.DB.prepare(
            "INSERT INTO assets(id,project_id,kind,r2_key,mime,created_at,expires_at) VALUES(?,?,'source',?,'image/png',?,?)",
          ).bind(row.id, id, row.key, now, now - 1),
        ),
    );
  await cleanup(env);
  expect(
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM assets WHERE removed_at IS NULL').first<{
        n: number;
      }>()
    )?.n,
  ).toBe(1);
  await cleanup(env);
  expect(
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM assets WHERE removed_at IS NULL').first<{
        n: number;
      }>()
    )?.n,
  ).toBe(0);
  expect((await env.MEDIA.list({ prefix: `${id}/` })).objects).toHaveLength(0);
});

it('stops native infrastructure failures without buying replacement images', async () => {
  const png = await readFile(new URL('../public/fixtures/portrait-1.png', import.meta.url));
  const live = {
    ...env,
    MODE: 'real',
    PAID_GENERATION_ENABLED: 'true',
    APP_ORIGIN: 'https://studio.test',
    FAL_KEY: 'test-only',
    ASSET_SIGNING_SECRET: 'x'.repeat(64),
    TURNSTILE_SECRET: 'test-only',
    TURNSTILE_SITE_KEY: 'test-site',
    FAL_WEBHOOK_USER_ID: 'test-user',
    PILOT_APPROVED: 'true',
    MUSIC_CLEARED: 'true',
    PRICE_CONFIG_VERIFIED: 'true',
    TEXT_MODEL: '@cf/google/gemma-4-26b-a4b-it',
    TEXT_COST_USD: '0.001',
    REVIEW_COST_USD: '0.001',
    RENDER_COST_USD: '0.005',
    PROCESSING_COST_USD: '0.001',
    AI: {},
    REVIEW_ENABLED: 'false',
    PROVIDER_OUTPUT_HOSTS: 'fal.media',
    RENDERER: {
      getByName: () => ({
        fetch: async (request: Request) => {
          await request.arrayBuffer();
          return new Response(JSON.stringify({ category: 'URLError' }), { status: 503 });
        },
      }),
    },
  } as unknown as AppEnv;
  let submissions = 0;
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://queue.fal.run/') && init?.method === 'POST') {
      submissions++;
      return new Response(JSON.stringify({ request_id: 'known-completed-image' }));
    }
    if (url.endsWith('/status')) return new Response('{"status":"COMPLETED"}');
    if (url.startsWith('https://queue.fal.run/'))
      return new Response('{"images":[{"url":"https://v3.fal.media/test.png"}]}');
    if (url === 'https://v3.fal.media/test.png') return new Response(png);
    throw new Error('Unexpected test network request');
  });
  const step = {
    do: async (_name: string, configOrRun: unknown, run?: () => Promise<unknown>) =>
      (typeof configOrRun === 'function' ? (configOrRun as () => Promise<unknown>) : run!)(),
    sleep: async () => {},
  } as unknown as WorkflowStep;
  // Node requires this streaming flag; the Workers Request constructor does not.
  const NodeRequest = globalThis.Request;
  vi.stubGlobal(
    'Request',
    class extends NodeRequest {
      constructor(input: RequestInfo | URL, init: RequestInit = {}) {
        super(input, { ...init, duplex: 'half' } as RequestInit);
      }
    },
  );
  try {
    await expect(
      produceArtifact(
        live,
        step,
        id,
        'portrait-0',
        {
          kind: 'image',
          input: { prompt: 'Test portrait', portrait: true, referenceUrls: [] },
        },
        'portrait-1.png',
      ),
    ).rejects.toMatchObject({ code: 'processing' });
    expect(submissions).toBe(1);
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM attempts').first<{ n: number }>())?.n,
    ).toBe(1);
  } finally {
    fetchMock.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('shares confirmed crops for inference but refuses full source photos even with a valid signature', async () => {
  const { inferenceUrl, authorizedInference } = await import('../src/server/media');
  const { sign } = await import('../src/server/crypto');
  const live = {
    ...env,
    MODE: 'real',
    APP_ORIGIN: 'https://studio.test',
    ASSET_SIGNING_SECRET: 'x'.repeat(64),
  } as AppEnv;
  const now = Date.now();
  for (const kind of ['source', 'crop', 'portrait', 'frame'] as const) {
    await env.DB.prepare(
      'INSERT INTO assets(id,project_id,kind,r2_key,mime,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
    )
      .bind(kind, id, kind, `${id}/${kind}`, 'image/jpeg', now, now + 86400000)
      .run();
  }
  await expect(inferenceUrl(live, id, 'source')).rejects.toMatchObject({ code: 'reference' });
  const expires = String(Math.floor(now / 1000) + 3600);
  const signature = await sign(live.ASSET_SIGNING_SECRET!, `read:${id}:source:${expires}`);
  await expect(authorizedInference(live, id, 'source', expires, signature)).rejects.toMatchObject({
    code: 'reference',
  });
  for (const kind of ['crop', 'portrait', 'frame']) {
    const url = new URL(await inferenceUrl(live, id, kind));
    expect(
      (
        await authorizedInference(
          live,
          id,
          kind,
          url.searchParams.get('expires')!,
          url.searchParams.get('signature')!,
        )
      ).kind,
    ).toBe(kind);
  }
});

it('removes local dev usage caps while retaining accounting and enforcing limits for main', async () => {
  const { drafts } = await import('../src/server/drafts');
  const { Hono } = await import('hono');
  const { AppError } = await import('../src/server/errors');
  const api = new Hono<{ Bindings: AppEnv }>();
  api.route('/', drafts);
  api.onError((error, c) =>
    c.json(
      { code: error instanceof AppError ? error.code : 'technical' },
      error instanceof AppError ? error.status : 500,
    ),
  );
  const { unlimitedLocalDev } = await import('../src/server/env');
  const { saveAsset } = await import('../src/server/db');
  const ai = vi.fn(async (_model: unknown, input: { messages: { content: string }[] }) => {
    const data = JSON.parse(input.messages[1].content);
    return {
      response: JSON.stringify({
        descriptions: data.characterIds.map((id: string) => ({
          id,
          description: 'A cheerful perfectionist with a tiny victory dance.',
        })),
      }),
    };
  });
  const live = {
    ...env,
    MODE: 'real',
    RELEASE_CHANNEL: 'dev',
    LOCAL_DEV_ONLY: 'true',
    DEV_UNLIMITED_USAGE: 'true',
    DEV_OPERATOR_SECRET: 'x'.repeat(64),
    APP_ORIGIN: 'https://studio.test',
    FAL_KEY: 'test',
    ASSET_SIGNING_SECRET: 'y'.repeat(64),
    TURNSTILE_SECRET: 'test',
    TURNSTILE_SITE_KEY: 'test',
    FAL_WEBHOOK_USER_ID: 'test',
    PAID_GENERATION_ENABLED: 'true',
    PILOT_APPROVED: 'true',
    MUSIC_CLEARED: 'true',
    PRICE_CONFIG_VERIFIED: 'true',
    MAX_PROJECTS_PER_DAY: '1',
    MAX_NETWORK_PROJECTS_PER_DAY: '1',
    MAX_DESCRIPTION_REQUESTS: '1',
    MAX_JOB_COST_USD: '0.000001',
    DAILY_BUDGET_USD: '0.000001',
    TEXT_MODEL: '@cf/google/gemma-4-26b-a4b-it',
    TEXT_COST_USD: '0.01',
    REVIEW_COST_USD: '0.01',
    RENDER_COST_USD: '0.01',
    PROCESSING_COST_USD: '0.01',
    AI: { run: ai },
    RENDERER: {},
  } as unknown as AppEnv;
  expect(unlimitedLocalDev(live)).toBe(true);
  for (const patch of [
    { MODE: 'mock' },
    { RELEASE_CHANNEL: 'main' },
    { LOCAL_DEV_ONLY: 'false' },
    { DEV_OPERATOR_SECRET: '' },
  ])
    expect(unlimitedLocalDev({ ...live, ...patch } as AppEnv)).toBe(false);
  const first = await api.request('/projects', { method: 'POST' }, live);
  expect(first.status).toBe(201);
  const cookie = first.headers.get('set-cookie')!.split(';')[0];
  const firstProject = (await first.json()) as { id: string };
  await env.DB.prepare("UPDATE projects SET state='failed' WHERE id=?").bind(firstProject.id).run();
  const second = await api.request(
    '/projects',
    { method: 'POST', headers: { Cookie: cookie } },
    live,
  );
  expect(second.status).toBe(201);
  const secondProject = (await second.json()) as { id: string };
  const source = await saveAsset(
    live,
    secondProject.id,
    'source',
    new Uint8Array([1]),
    'image/jpeg',
  );
  const character = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO characters(id,project_id,ordinal,source_asset_id,crop,framing) VALUES(?,?,0,?,?, 'manual')",
  )
    .bind(character, secondProject.id, source, JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }))
    .run();
  await env.DB.prepare('UPDATE projects SET description_requests=1000 WHERE id=?')
    .bind(secondProject.id)
    .run();
  const request = () => ({
    method: 'POST',
    headers: { Cookie: cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ characterIds: [character], onlyEmpty: false }),
  });
  for (let i = 0; i < 2; i++)
    expect(
      (await api.request(`/projects/${secondProject.id}/character-descriptions`, request(), live))
        .status,
    ).toBe(200);
  expect(ai).toHaveBeenCalledTimes(2);
  expect(
    await env.DB.prepare('SELECT description_requests FROM projects WHERE id=?')
      .bind(secondProject.id)
      .first('description_requests'),
  ).toBe(1002);
  await reserve(live, secondProject.id, 'large-local-reservation', 1000000);
  expect(
    await env.DB.prepare('SELECT amount_micros FROM reservations WHERE id=?')
      .bind('large-local-reservation')
      .first('amount_micros'),
  ).toBe(1000000);
  const main = { ...live, RELEASE_CHANNEL: 'main' } as AppEnv;
  expect(
    (await api.request(`/projects/${secondProject.id}/character-descriptions`, request(), main))
      .status,
  ).toBe(429);
  await expect(reserve(main, secondProject.id, 'limited-main', 1000000)).rejects.toMatchObject({
    code: 'budget',
  });
  await env.DB.prepare("UPDATE projects SET state='failed' WHERE id=?")
    .bind(secondProject.id)
    .run();
  expect(
    (await api.request('/projects', { method: 'POST', headers: { Cookie: cookie } }, main)).status,
  ).toBe(429);
});
