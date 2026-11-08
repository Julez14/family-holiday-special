import type { AppEnv } from './env';
import { signingKey } from './env';
import { sign, verifyHmac } from './crypto';
import { AppError } from './errors';
import { statement, type AssetRow, project } from './db';
export async function inferenceUrl(
  env: AppEnv,
  projectId: string,
  assetId: string,
  ttlSeconds = 3600,
) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = await sign(signingKey(env), `read:${projectId}:${assetId}:${expires}`);
  return `${env.APP_ORIGIN}/api/inference/${projectId}/${assetId}?expires=${expires}&signature=${signature}`;
}
export async function authorizedInference(
  env: AppEnv,
  projectId: string,
  assetId: string,
  expires: string,
  signature: string,
) {
  if (
    !/^\d{10}$/.test(expires) ||
    Number(expires) < Date.now() / 1000 ||
    Number(expires) > Date.now() / 1000 + 7201 ||
    !(await verifyHmac(signingKey(env), `read:${projectId}:${assetId}:${expires}`, signature))
  )
    throw new AppError(403, 'signature', 'This reference has expired.');
  await project(env, projectId);
  const a = await statement(
    env,
    'SELECT * FROM assets WHERE id=? AND project_id=? AND expires_at>?',
    assetId,
    projectId,
    Date.now(),
  ).first<AssetRow>();
  if (!a) throw new AppError(404, 'asset', 'This reference is unavailable.');
  return a;
}
export async function serveAsset(
  env: AppEnv,
  a: AssetRow,
  request: Request,
  download = false,
): Promise<Response> {
  const head = await env.MEDIA.head(a.r2_key);
  if (!head) throw new AppError(404, 'asset', 'This media is no longer available.');
  const headers = new Headers({
    'content-type': a.mime,
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });
  if (download)
    headers.set('content-disposition', 'attachment; filename="family-christmas-cartoon.mp4"');
  const range = request.headers.get('range');
  let offset = 0;
  let length = head.size;
  let status = 200;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2]))
      return new Response(null, {
        status: 416,
        headers: { ...Object.fromEntries(headers), 'content-range': `bytes */${head.size}` },
      });
    offset = m[1] ? Number(m[1]) : Math.max(0, head.size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), head.size - 1) : head.size - 1;
    if (offset > end || offset >= head.size)
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${head.size}` },
      });
    length = end - offset + 1;
    status = 206;
    headers.set('content-range', `bytes ${offset}-${end}/${head.size}`);
  }
  headers.set('content-length', String(length));
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const object = await env.MEDIA.get(a.r2_key, { range: { offset, length } });
  return new Response(object?.body ?? null, { status, headers });
}
export async function boundedBody(request: Request | Response, max: number): Promise<Uint8Array> {
  const contentLength = Number(request.headers.get('content-length'));
  if (contentLength > max) throw new AppError(413, 'size', 'This file is too large.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new AppError(413, 'size', 'This file is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}
