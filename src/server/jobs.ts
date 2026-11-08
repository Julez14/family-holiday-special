import { Hono } from 'hono';
import type { AppEnv } from './env';
import { owned, draft } from './auth';
import { statement, project, view, characters, characterInput, recordEvent } from './db';
import { compileManifest } from '../shared/presets';
import { generateSchema } from '../shared/contracts';
import { sha256 } from './crypto';
import { AppError } from './errors';
import { realReady } from './budget';
import { usdMicros } from '../shared/policies';
import { illustrativePreviews } from './env';
import { authorizedDevGeneration } from './dev-operator';
export const jobs = new Hono<{ Bindings: AppEnv }>();
jobs.post('/projects/:id/generate', async (c) => {
  const p = await owned(c);
  const body = generateSchema.parse(await c.req.json());
  const key = c.req.header('Idempotency-Key');
  if (!key || !/^[a-zA-Z0-9-]{16,80}$/.test(key))
    throw new AppError(400, 'idempotency', 'A valid generation key is required.');
  if (p.state !== 'draft') {
    if (p.idempotency_key === key && p.workflow_id)
      return c.json({ projectId: p.id, jobId: p.workflow_id }, 202);
    throw new AppError(409, 'immutable', 'This cartoon already has a generation job.');
  }
  draft(p);
  realReady(c.env);
  if (!p.preset) throw new AppError(400, 'preset', 'Choose one Christmas scene.');
  const cast = (await characters(c.env, p.id)).map(characterInput);
  if (!cast.length)
    throw new AppError(400, 'cast', 'Add one clear individual portrait for each person.');
  const manifest = compileManifest(p.preset, cast, p.seed);
  const cost = await statement(
    c.env,
    "SELECT COALESCE(SUM(amount_micros),0) AS cost FROM reservations WHERE project_id=? AND state!='released'",
    p.id,
  ).first<{ cost: number }>();
  const baseline =
    (cast.length + 4) * usdMicros(c.env.IMAGE_COST_USD) +
    4 * usdMicros(c.env.VIDEO_COST_USD) +
    usdMicros(c.env.RENDER_COST_USD);
  if (baseline + (cost?.cost ?? 0) > usdMicros(c.env.MAX_JOB_COST_USD))
    throw new AppError(
      429,
      'budget',
      'This cast exceeds the demo’s configured spending limit. Your setup is saved.',
    );
  if (c.env.MODE === 'real') {
    if (!(await authorizedDevGeneration(c.env, p.id, key, c.req.raw.headers))) {
      const form = new FormData();
      form.set('secret', c.env.TURNSTILE_SECRET!);
      form.set('response', body.turnstileToken ?? '');
      form.set('idempotency_key', crypto.randomUUID());
      const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(10000),
      });
      const verification = (await result.json()) as {
        success?: boolean;
        hostname?: string;
        action?: string;
      };
      if (
        !verification.success ||
        verification.hostname !== new URL(c.env.APP_ORIGIN).hostname ||
        verification.action !== 'generate'
      )
        throw new AppError(
          403,
          'turnstile',
          'Please complete the quick security check and try again.',
        );
    }
    for (const key of [
      ...['snowball', 'giftwrap', 'danceoff'].flatMap((id) => [
        `music/${id}.wav`,
        ...(illustrativePreviews(c.env) ? [] : [`samples/${id}.mp4`, `samples/${id}.jpg`]),
      ]),
    ])
      if (!(await c.env.MEDIA.head(key)))
        throw new AppError(
          503,
          'launch_assets',
          'The holiday studio is still being prepared. Your setup is saved.',
        );
  }
  const serialized = JSON.stringify(manifest);
  const hash = await sha256(serialized);
  const workflowId = `production-${p.id}`;
  const result = await statement(
    c.env,
    "UPDATE projects SET state='queued', manifest=?,manifest_hash=?,idempotency_key=?,workflow_id=?,revision=revision+1,updated_at=? WHERE id=? AND state='draft' AND revision=? AND description_busy=0",
    serialized,
    hash,
    key,
    workflowId,
    Date.now(),
    p.id,
    p.revision,
  ).run();
  if (!result.meta.changes) {
    const current = await project(c.env, p.id);
    if (current.idempotency_key === key)
      return c.json({ projectId: p.id, jobId: current.workflow_id }, 202);
    throw new AppError(409, 'revision', 'This setup changed. Reload it before generating.');
  }
  // Persisted queued rows are an outbox: scheduled reconciliation starts a missing instance.
  try {
    await c.env.PRODUCTION.create({ id: workflowId, params: { projectId: p.id } });
  } catch {
    /* The create outcome may be unknown. Never create a new logical instance ID. */
  }
  await recordEvent(c.env, 'generation_requested', p.id, p.preset);
  return c.json({ projectId: p.id, jobId: workflowId }, 202);
});
jobs.delete('/projects/:id', async (c) => {
  const p = await owned(c);
  await c.env.DB.batch([
    statement(
      c.env,
      "UPDATE projects SET state='deleting',updated_at=?,expires_at=? WHERE id=?",
      Date.now(),
      Date.now(),
      p.id,
    ),
    statement(c.env, 'UPDATE shares SET revoked_at=? WHERE project_id=?', Date.now(), p.id),
  ]);
  c.executionCtx.waitUntil(
    (async () => {
      if (p.workflow_id) {
        try {
          await (await c.env.PRODUCTION.get(p.workflow_id)).terminate();
        } catch {
          /* cleanup remains retryable */
        }
      }
      const pending = await statement(
        c.env,
        "SELECT model,request_id FROM attempts WHERE project_id=? AND request_id IS NOT NULL AND state IN ('queued','submitting','in_progress')",
        p.id,
      ).all<{ model: string; request_id: string }>();
      if (c.env.MODE === 'real' && c.env.FAL_KEY)
        for (const a of pending.results) {
          try {
            await fetch(
              `https://queue.fal.run/${a.model.split('/').slice(0, 2).join('/')}/requests/${a.request_id}/cancel`,
              {
                method: 'PUT',
                headers: { authorization: `Key ${c.env.FAL_KEY}` },
                signal: AbortSignal.timeout(5000),
              },
            );
          } catch {
            /* best effort */
          }
        }
    })(),
  );
  return c.json({ state: 'deleting' }, 202);
});
jobs.get('/projects/:id/status', async (c) => c.json(await view(c.env, await owned(c))));
