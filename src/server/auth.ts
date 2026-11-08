import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { randomToken, sha256 } from './crypto';
import { statement, project } from './db';
import { AppError } from './errors';
import type { AppEnv } from './env';
import { DAY } from '../shared/policies';
export type ApiContext = Context<{ Bindings: AppEnv }>;
export async function session(c: ApiContext, create = false): Promise<string> {
  const secret = getCookie(c, '__Host-holiday-owner');
  if (secret && /^[a-f0-9]{64}$/.test(secret)) {
    const row = await statement(
      c.env,
      'SELECT id FROM sessions WHERE secret_hash=? AND expires_at>?',
      await sha256(secret),
      Date.now(),
    ).first<{ id: string }>();
    if (row) return row.id;
  }
  if (!create)
    throw new AppError(401, 'session', 'Open this project in the browser where you created it.');
  const token = randomToken();
  const id = crypto.randomUUID();
  await statement(
    c.env,
    'INSERT INTO sessions VALUES(?,?,?,?)',
    id,
    await sha256(token),
    Date.now(),
    Date.now() + 120 * DAY,
  ).run();
  setCookie(c, '__Host-holiday-owner', token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 120 * 86400,
  });
  return id;
}
export async function owned(c: ApiContext) {
  const ownerId = await session(c);
  const p = await project(c.env, c.req.param('id')!);
  if (p.owner_id !== ownerId)
    throw new AppError(404, 'not_found', 'This project isn’t available in this browser.');
  return p;
}
export function draft(p: { state: string; description_busy: number }) {
  if (p.state !== 'draft')
    throw new AppError(
      409,
      'immutable',
      'This cartoon has already started. Its cast and scenes are saved.',
    );
  if (p.description_busy)
    throw new AppError(409, 'busy', 'Wait for the character descriptions to finish.');
}
export function validateOrigin(c: ApiContext) {
  const origin = c.req.header('Origin');
  // Browser mutations always send Origin. Do not accept cross-origin or missing-origin writes.
  if (!origin || origin !== c.env.APP_ORIGIN)
    throw new AppError(403, 'origin', 'Please use the app’s own page to make changes.');
}
