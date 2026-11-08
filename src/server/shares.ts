import { Hono } from 'hono';
import type { AppEnv } from './env';
import { signingKey } from './env';
import { owned } from './auth';
import { statement, recordEvent, type AssetRow } from './db';
import { sha256, sign } from './crypto';
import { AppError } from './errors';
import { serveAsset } from './media';
import { getPreset } from '../shared/presets';
import type { PresetId } from '../shared/contracts';
export const shares = new Hono<{ Bindings: AppEnv }>();
shares.post('/api/projects/:id/share', async (c) => {
  const p = await owned(c);
  if (p.state !== 'ready' || !p.active_render_id)
    throw new AppError(409, 'not_ready', 'Your cartoon needs to finish before it can be shared.');
  const token = await sign(signingKey(c.env), `share:${p.id}:${p.active_render_id}`);
  await statement(
    c.env,
    'INSERT OR IGNORE INTO shares(token_hash,project_id,render_id,created_at,expires_at) VALUES(?,?,?,?,?)',
    await sha256(token),
    p.id,
    p.active_render_id,
    Date.now(),
    p.expires_at,
  ).run();
  await recordEvent(c.env, 'share_link_created', p.id, p.preset);
  return c.json({ url: `${c.env.APP_ORIGIN}/s/${token}`, expiresAt: p.expires_at });
});
async function lookup(env: AppEnv, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new AppError(404, 'share', 'This holiday cartoon is no longer available.');
  const row = await statement(
    env,
    `SELECT s.project_id,s.expires_at,p.preset,r.video_asset_id,r.poster_asset_id FROM shares s
 JOIN projects p ON p.id=s.project_id JOIN renders r ON r.id=s.render_id
 WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND p.state='ready' AND p.expires_at>? AND r.state='ready' AND p.active_render_id=r.id`,
    await sha256(token),
    Date.now(),
    Date.now(),
  ).first<{
    project_id: string;
    expires_at: number;
    preset: PresetId;
    video_asset_id: string;
    poster_asset_id: string;
  }>();
  if (!row) throw new AppError(404, 'share', 'This holiday cartoon is no longer available.');
  return row;
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
shares.get('/s/:token', async (c) => {
  const s = await lookup(c.env, c.req.param('token'));
  const path = `/s/${c.req.param('token')}`;
  const url = escape(c.env.APP_ORIGIN + path);
  const title = escape(`${getPreset(s.preset).title} · Family Christmas Cartoon`);
  await recordEvent(c.env, 'share_page_viewed', s.project_id, s.preset);
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta property="og:type" content="video.other"><meta property="og:title" content="${title}"><meta property="og:description" content="Familiar faces. A little holiday chaos. A goofy Christmas cartoon made to share."><meta property="og:image" content="${url}/poster"><meta property="og:url" content="${url}"><meta name="twitter:card" content="summary_large_image"><style>body{margin:0;background:#faf6eb;color:#173e35;font-family:system-ui}main{max-width:960px;margin:7vh auto;padding:24px;text-align:center}h1{font-family:Georgia,serif;font-size:clamp(2rem,5vw,3.5rem)}video{display:block;width:100%;border-radius:20px;background:#173e35}a{display:inline-block;padding:16px 26px;margin:18px 8px;border-radius:40px;background:#b52e38;color:white;text-decoration:none;font-weight:700}p{line-height:1.6}small{display:block}a:focus-visible{outline:3px solid #173e35;outline-offset:4px}</style></head><body><main><p>FAMILY CHRISTMAS CARTOON</p><h1>A little holiday chaos.<br>A lot of familiar faces.</h1>${c.env.MODE === 'mock' ? '<p><strong>Demo fixture · Illustrative animation, not generated from the uploaded photos.</strong></p>' : ''}<video controls playsinline preload="metadata" poster="${path}/poster" src="${path}/media"></video><a href="/?from=share">Make your own cartoon ↗</a><a href="${path}/media?download=1" download>Download video</a><small>Unlisted · Anyone with this link can watch.</small><p>Available until ${escape(new Date(s.expires_at).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }))}.</p></main></body></html>`,
  );
});
for (const kind of ['media', 'poster'] as const)
  shares.get(`/s/:token/${kind}`, async (c) => {
    const s = await lookup(c.env, c.req.param('token'));
    const a = await statement(
      c.env,
      'SELECT * FROM assets WHERE id=? AND project_id=? AND kind=? AND expires_at>?',
      kind === 'media' ? s.video_asset_id : s.poster_asset_id,
      s.project_id,
      kind === 'media' ? 'video' : 'poster',
      Date.now(),
    ).first<AssetRow>();
    if (!a) throw new AppError(404, 'share', 'This holiday cartoon is no longer available.');
    if (c.req.query('download') === '1' && kind === 'media')
      await recordEvent(c.env, 'download_requested', s.project_id, s.preset);
    return serveAsset(c.env, a, c.req.raw, kind === 'media' && c.req.query('download') === '1');
  });
