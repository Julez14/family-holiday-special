import type { AppEnv } from './env';
import { statement } from './db';
import { usdMicros } from '../shared/policies';
import { AppError, unavailable } from './errors';
export function realReady(env: AppEnv) {
  if (env.MODE === 'mock') return;
  if (env.MODE !== 'real') throw unavailable();
  if (
    env.PAID_GENERATION_ENABLED !== 'true' ||
    !env.FAL_KEY ||
    !env.ASSET_SIGNING_SECRET ||
    env.ASSET_SIGNING_SECRET.length < 32 ||
    env.IMAGE_MODEL !== 'openai/gpt-image-2.6/flare/edit' ||
    env.VIDEO_MODEL !== 'minimax/h3-max/reference-to-video' ||
    !env.TURNSTILE_SECRET ||
    !('AI' in env) ||
    !('RENDERER' in env) ||
    env.PILOT_APPROVED !== 'true' ||
    env.MUSIC_CLEARED !== 'true' ||
    env.PRICE_CONFIG_VERIFIED !== 'true' ||
    !env.FAL_WEBHOOK_USER_ID ||
    !env.TURNSTILE_SITE_KEY
  )
    throw unavailable();
  for (const key of [
    'MAX_JOB_COST_USD',
    'DAILY_BUDGET_USD',
    'IMAGE_COST_USD',
    'VIDEO_COST_USD',
    'TEXT_COST_USD',
    'REVIEW_COST_USD',
    'RENDER_COST_USD',
    'PROCESSING_COST_USD',
  ] as const)
    usdMicros(env[key]);
  if (
    !Number.isInteger(Number(env.MAX_PROVIDER_CONCURRENCY)) ||
    Number(env.MAX_PROVIDER_CONCURRENCY) < 1
  )
    throw unavailable();
}
// A single SQLite statement serializes competing reservations across projects and sessions.
// Unknown external submissions retain their reservations; estimates are never presented as bills.
export async function reserve(env: AppEnv, projectId: string, id: string, amount: number) {
  realReady(env);
  const now = Date.now();
  await statement(
    env,
    `INSERT OR IGNORE INTO reservations(id,project_id,day,amount_micros,created_at)
 SELECT ?,?,?,?,? WHERE
 (SELECT COALESCE(SUM(amount_micros),0) FROM reservations WHERE day=? AND state!='released') + ? <= ?
 AND (SELECT COALESCE(SUM(amount_micros),0) FROM reservations WHERE project_id=? AND state!='released') + ? <= ?
 AND EXISTS(SELECT 1 FROM projects WHERE id=? AND state NOT IN ('deleting','deleted','expired','failed','ready'))`,
    id,
    projectId,
    new Date(now).toISOString().slice(0, 10),
    amount,
    now,
    new Date(now).toISOString().slice(0, 10),
    amount,
    usdMicros(env.DAILY_BUDGET_USD),
    projectId,
    amount,
    usdMicros(env.MAX_JOB_COST_USD),
    projectId,
  ).run();
  const row = await statement(
    env,
    'SELECT amount_micros FROM reservations WHERE id=? AND project_id=?',
    id,
    projectId,
  ).first<{ amount_micros: number }>();
  if (!row || row.amount_micros !== amount)
    throw new AppError(
      429,
      'budget',
      'The demo’s spending limit has been reached. Your setup is saved.',
    );
}
export async function settle(env: AppEnv, id: string, released = false) {
  await statement(
    env,
    "UPDATE reservations SET state=? WHERE id=? AND state='reserved'",
    released ? 'released' : 'estimated',
    id,
  ).run();
}
