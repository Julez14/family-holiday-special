import type { AppEnv } from './env';
import type {
  ProjectState,
  PresetId,
  CharacterInput,
  ProjectView,
  AssetKind,
} from '../shared/contracts';
import { errorMessage, AppError } from './errors';
export interface ProjectRow {
  id: string;
  owner_id: string;
  state: ProjectState;
  revision: number;
  preset: PresetId | null;
  manifest: string | null;
  manifest_hash: string | null;
  workflow_id: string | null;
  idempotency_key: string | null;
  seed: number;
  description_requests: number;
  description_busy: number;
  error_code: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  expires_at: number;
  intermediates_expire_at: number | null;
  active_render_id: string | null;
}
export interface CharacterRow {
  id: string;
  source_asset_id: string;
  name: string;
  description: string;
  provenance: 'user' | 'llm';
  crop: string;
  framing: 'manual' | 'detected';
  canonical_asset_id: string | null;
  wardrobe: string | null;
}
export interface AssetRow {
  id: string;
  project_id: string;
  kind: AssetKind;
  r2_key: string;
  mime: string;
  width: number;
  height: number;
  duration: number | null;
  expires_at: number;
}
export interface AttemptRow {
  id: string;
  project_id: string;
  artifact: string;
  revision: number;
  stage: string;
  model: string;
  request_id: string | null;
  state: string;
  error_category: string | null;
  output_asset_id: string | null;
  estimate_micros: number;
  created_at: number;
}
export function statement(env: AppEnv, sql: string, ...values: (string | number | null)[]) {
  return env.DB.prepare(sql).bind(...values);
}
export async function project(env: AppEnv, id: string): Promise<ProjectRow> {
  const p = await statement(env, 'SELECT * FROM projects WHERE id = ?', id).first<ProjectRow>();
  if (!p || ['deleting', 'deleted', 'expired'].includes(p.state) || p.expires_at <= Date.now())
    throw new AppError(404, 'not_found', 'This cartoon is no longer available.');
  return p;
}
export async function characters(env: AppEnv, id: string) {
  return (
    await statement(
      env,
      'SELECT * FROM characters WHERE project_id = ? ORDER BY ordinal',
      id,
    ).all<CharacterRow>()
  ).results;
}
export function characterInput(c: CharacterRow): CharacterInput {
  return {
    id: c.id,
    sourceAssetId: c.source_asset_id,
    name: c.name,
    description: c.description,
    provenance: c.provenance,
    crop: JSON.parse(c.crop),
    framing: c.framing,
  };
}
export async function recordEvent(
  env: AppEnv,
  name: string,
  projectId: string | null,
  preset: string | null = null,
  value: number | null = null,
) {
  await statement(
    env,
    'INSERT INTO events(name,project_id,preset,value,created_at) VALUES(?,?,?,?,?)',
    name,
    projectId,
    preset,
    value,
    Date.now(),
  ).run();
}
export async function view(env: AppEnv, p: ProjectRow): Promise<ProjectView> {
  const [cast, shots, costs, render] = await Promise.all([
    characters(env, p.id),
    statement(env, 'SELECT * FROM shots WHERE project_id = ? ORDER BY ordinal', p.id).all<{
      id: string;
      ordinal: number;
      frame_asset_id: string | null;
      clip_asset_id: string | null;
    }>(),
    statement(
      env,
      "SELECT COALESCE(SUM(amount_micros),0) AS total FROM reservations WHERE project_id=? AND state != 'released'",
      p.id,
    ).first<{ total: number }>(),
    p.active_render_id
      ? statement(env, 'SELECT * FROM renders WHERE id=?', p.active_render_id).first<{
          video_asset_id: string;
          poster_asset_id: string;
        }>()
      : Promise.resolve(null),
  ]);
  const assetUrl = (id: string) => `/api/projects/${p.id}/assets/${id}`;
  return {
    id: p.id,
    state: p.state,
    revision: p.revision,
    preset: p.preset,
    mode: env.MODE === 'real' ? 'real' : 'mock',
    characters: cast.map((c) => ({
      ...characterInput(c),
      sourceUrl: assetUrl(c.source_asset_id),
      canonicalUrl: c.canonical_asset_id ? assetUrl(c.canonical_asset_id) : undefined,
      wardrobe: c.wardrobe ?? undefined,
    })),
    shots: shots.results.map((s) => ({
      id: s.id,
      order: s.ordinal,
      frameUrl: s.frame_asset_id ? assetUrl(s.frame_asset_id) : undefined,
      clipReady: !!s.clip_asset_id,
    })),
    error: p.state === 'failed' ? errorMessage(p.error_code) : undefined,
    expiresAt: p.expires_at,
    videoUrl: render ? assetUrl(render.video_asset_id) : undefined,
    posterUrl: render ? assetUrl(render.poster_asset_id) : undefined,
    costEstimateUsd: (costs?.total ?? 0) / 1_000_000,
  };
}
export async function saveAsset(
  env: AppEnv,
  projectId: string,
  kind: AssetKind,
  body: ReadableStream | ArrayBuffer | Uint8Array,
  mime: string,
  meta: { width?: number; height?: number; duration?: number } = {},
) {
  const id = crypto.randomUUID();
  const key = `${projectId}/${kind}/${id}`;
  await env.MEDIA.put(key, body, { httpMetadata: { contentType: mime } });
  const inserted = await statement(
    env,
    "INSERT INTO assets(id,project_id,kind,r2_key,mime,width,height,duration,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND state NOT IN ('deleting','deleted','expired') AND expires_at>?)",
    id,
    projectId,
    kind,
    key,
    mime,
    meta.width ?? null,
    meta.height ?? null,
    meta.duration ?? null,
    Date.now(),
    Date.now() + 86400000,
    projectId,
    Date.now(),
  ).run();
  if (!inserted.meta.changes) {
    await env.MEDIA.delete(key);
    throw new AppError(404, 'deleted', 'This cartoon is no longer available.');
  }
  return id;
}
