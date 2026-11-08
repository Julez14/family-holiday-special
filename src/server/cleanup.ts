import type { AppEnv } from './env';
import { statement } from './db';
import { DAY } from '../shared/policies';
export async function cleanup(env: AppEnv) {
 const now = Date.now();
 await env.DB.batch([
  statement(env, "UPDATE projects SET state='expired',updated_at=? WHERE expires_at<=? AND state NOT IN ('deleted','deleting','expired')", now, now),
  statement(env, "UPDATE shares SET revoked_at=COALESCE(revoked_at,?) WHERE expires_at<=? OR project_id IN (SELECT id FROM projects WHERE state IN ('deleting','deleted','expired'))", now, now),
 ]);
 const doomed = await statement(env, "SELECT id,state,workflow_id FROM projects WHERE state IN ('deleting','expired','deleted') AND cleanup_done=0 LIMIT 25").all<{ id: string; state: string; workflow_id: string | null }>();
 for (const p of doomed.results) {
  if (p.workflow_id) { try { await (await env.PRODUCTION.get(p.workflow_id)).terminate(); } catch { /* assets still cleaned */ } }
  const objects = await env.MEDIA.list({ prefix: `${p.id}/`, limit: 1000 });
  if (objects.objects.length) await env.MEDIA.delete(objects.objects.map(o => o.key));
  // Prefix scanning also catches bytes written just before their D1 asset insert was interrupted.
  if (!objects.truncated) await env.DB.batch([
   statement(env, "UPDATE characters SET name='',description='',crop='{}' WHERE project_id=?", p.id),
   statement(env, "UPDATE projects SET state=CASE WHEN state='deleting' THEN 'deleted' ELSE state END,manifest=NULL,cleanup_done=1 WHERE id=?", p.id),
   statement(env, 'DELETE FROM webhook_inbox WHERE attempt_id IN (SELECT id FROM attempts WHERE project_id=?)', p.id),
  ]);
 }
 // Sources expire independently; never cascade to the finished render or share.
 const expired = await statement(env, "SELECT id,r2_key FROM assets WHERE expires_at<=? AND project_id IN (SELECT id FROM projects WHERE state NOT IN ('creating_cast','creating_frames','animating','rendering','queued')) LIMIT 200", now).all<{ id: string; r2_key: string }>();
 for (const a of expired.results) await env.MEDIA.delete(a.r2_key);
 const queued = await statement(env, "SELECT id,workflow_id FROM projects WHERE state='queued' AND updated_at<? AND expires_at>? LIMIT 20", now - 60000, now).all<{ id: string; workflow_id: string }>();
 for (const p of queued.results) {
  try {
   const instance = await env.PRODUCTION.get(p.workflow_id);
   const status = await instance.status();
   if (status.status === 'errored') await statement(env, "UPDATE projects SET state='failed',error_code='technical',intermediates_expire_at=?,expires_at=? WHERE id=? AND state='queued'", now + 7 * DAY, now + 7 * DAY, p.id).run();
  } catch { try { await env.PRODUCTION.create({ id: p.workflow_id, params: { projectId: p.id } }); } catch { /* stable instance ID reconciles at next tick */ } }
 }
 await env.DB.batch([
  statement(env, 'DELETE FROM events WHERE created_at<?', now - 90 * DAY),
  statement(env, 'DELETE FROM webhook_inbox WHERE received_at<?', now - 7 * DAY),
 ]);
}
