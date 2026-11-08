import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import type { AppEnv } from '../src/server/env';
import { reserve } from '../src/server/budget';
import { prepareAttempt, claimSubmission } from '../src/server/attempts';
import { recordCallback } from '../src/server/webhook';
import { cleanup } from '../src/server/cleanup';
import type { MediaInput } from '../src/server/fal';
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
