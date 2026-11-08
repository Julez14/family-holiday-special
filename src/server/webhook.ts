import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from './env';
import { signingKey } from './env';
import { verifyHmac } from './crypto';
import { boundedBody } from './media';
import { falKeys, verifyFalSignature } from './fal';
import { statement, type AttemptRow } from './db';
import { AppError } from './errors';
export const webhooks = new Hono<{ Bindings: AppEnv }>();
export const callbackSchema = z.object({ request_id: z.string().min(1).max(160), status: z.enum(['OK','ERROR']), payload: z.unknown().optional(), error: z.unknown().optional() });
export async function recordCallback(env: AppEnv, attemptId: string, callback: z.infer<typeof callbackSchema>) {
 const a = await statement(env, `SELECT a.* FROM attempts a JOIN projects p ON p.id=a.project_id WHERE a.id=? AND p.state NOT IN ('deleting','deleted','expired','failed','ready') AND p.expires_at>?`, attemptId, Date.now()).first<AttemptRow>();
 if (!a || (a.request_id && a.request_id !== callback.request_id)) return;
 // Inbox insert + early receipt assignment are durable and atomic; callbacks never launch paid stages.
 await env.DB.batch([
  statement(env, 'INSERT OR IGNORE INTO webhook_inbox(request_id,attempt_id,status,payload,received_at) VALUES(?,?,?,?,?)', callback.request_id, attemptId, callback.status, JSON.stringify(callback.payload ?? null), Date.now()),
  statement(env, "UPDATE attempts SET request_id=?,state='queued',updated_at=? WHERE id=? AND request_id IS NULL AND state IN ('submitting','submission_unknown')", callback.request_id, Date.now(), attemptId),
 ]);
}
webhooks.post('/api/fal/webhook', async c => {
 // Mock callbacks are exercised through fixtures/tests, never an unsigned public bypass.
 if (c.env.MODE !== 'real' || !('FAL_WEBHOOK_USER_ID' in c.env)) throw new AppError(403, 'webhook', 'Invalid callback.');
 const attempt = c.req.query('attempt') ?? ''; const correlation = c.req.query('correlation') ?? '';
 if (!await verifyHmac(signingKey(c.env), `callback:${attempt}`, correlation)) throw new AppError(403, 'webhook', 'Invalid callback.');
 const bytes = await boundedBody(c.req.raw, 2 * 1024 * 1024);
 if (!await verifyFalSignature(c.req.raw.headers, bytes, await falKeys(), c.env.FAL_WEBHOOK_USER_ID)) throw new AppError(403, 'webhook', 'Invalid callback.');
 const data = callbackSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
 if (data.request_id !== c.req.header('x-fal-webhook-request-id')) throw new AppError(403, 'webhook', 'Invalid callback.');
 await recordCallback(c.env, attempt, data);
 return c.json({ received: true });
});
