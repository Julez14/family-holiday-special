import { Hono } from 'hono';
import { z } from 'zod';
import { imageSize } from 'image-size';
import type { AppEnv } from './env';
import { signingKey } from './env';
import { owned, session, draft } from './auth';
import { statement, view, project, characters, saveAsset, recordEvent, type AssetRow } from './db';
import { AppError } from './errors';
import { castUpdateSchema, uploadSchema, descriptionsSchema } from '../shared/contracts';
import { reserve, settle } from './budget';
import { DAY, usdMicros } from '../shared/policies';
import { sign } from './crypto';
import { boundedBody, serveAsset } from './media';
import { generateDescriptions } from './descriptions';
import { NATIVE_INSPECTOR } from './native-protocol';
export const drafts = new Hono<{ Bindings: AppEnv }>();

drafts.post('/projects', async (c) => {
  const owner = await session(c, true);
  const now = Date.now();
  const existing = await statement(
    c.env,
    "SELECT id FROM projects WHERE owner_id=? AND state IN ('draft','queued','creating_cast','creating_frames','animating','rendering') AND expires_at>? ORDER BY created_at DESC LIMIT 1",
    owner,
    now,
  ).first<{ id: string }>();
  if (existing) return c.json(await view(c.env, await project(c.env, existing.id)));
  const id = crypto.randomUUID();
  const network = await sign(
    signingKey(c.env),
    `${new Date(now).toISOString().slice(0, 10)}:${c.req.header('CF-Connecting-IP') ?? 'local'}`,
  );
  const result = await statement(
    c.env,
    `INSERT INTO projects(id,owner_id,network_hash,seed,created_at,updated_at,expires_at)
 SELECT ?,?,?,?,?,?,? WHERE
 (SELECT COUNT(*) FROM projects WHERE owner_id=? AND created_at>?) < ?
 AND (SELECT COUNT(*) FROM projects WHERE network_hash=? AND created_at>?) < ?
 AND NOT EXISTS(SELECT 1 FROM projects WHERE owner_id=? AND state IN ('draft','queued','creating_cast','creating_frames','animating','rendering') AND expires_at>?)`,
    id,
    owner,
    network,
    crypto.getRandomValues(new Uint32Array(1))[0],
    now,
    now,
    now + DAY,
    owner,
    now - DAY,
    Number(c.env.MAX_PROJECTS_PER_DAY),
    network,
    now - DAY,
    Number(c.env.MAX_NETWORK_PROJECTS_PER_DAY),
    owner,
    now,
  ).run();
  if (!result.meta.changes)
    throw new AppError(
      429,
      'rate',
      'You’ve reached today’s demo limit. Come back tomorrow for more holiday chaos.',
    );
  return c.json(await view(c.env, await project(c.env, id)), 201);
});
drafts.get('/projects/:id', async (c) => c.json(await view(c.env, await owned(c))));
drafts.patch('/projects/:id/cast', async (c) => {
  const p = await owned(c);
  draft(p);
  const body = castUpdateSchema.parse(await c.req.json());
  if (
    new Set(body.characters.map((x) => x.id)).size !== body.characters.length ||
    new Set(body.characters.map((x) => x.sourceAssetId)).size !== body.characters.length
  )
    throw new AppError(400, 'cast', 'Use one separate photo per person.');
  const old = await characters(c.env, p.id);
  for (const person of body.characters) {
    const source = await statement(
      c.env,
      "SELECT id FROM assets WHERE id=? AND project_id=? AND kind='source' AND expires_at>?",
      person.sourceAssetId,
      p.id,
      Date.now(),
    ).first();
    if (!source) throw new AppError(400, 'source', 'Please upload this person’s photo again.');
    const foreign = await statement(
      c.env,
      'SELECT project_id FROM characters WHERE id=? AND project_id!=?',
      person.id,
      p.id,
    ).first();
    if (foreign) throw new AppError(400, 'cast', 'Invalid character reference.');
  }
  const token = crypto.randomUUID();
  const revision = body.revision + 1;
  const queries = [
    statement(
      c.env,
      "UPDATE projects SET revision=revision+1,preset=?,updated_at=?,mutation_token=? WHERE id=? AND state='draft' AND revision=? AND description_busy=0",
      body.preset,
      Date.now(),
      token,
      p.id,
      body.revision,
    ),
    statement(
      c.env,
      'DELETE FROM characters WHERE project_id=? AND EXISTS(SELECT 1 FROM projects WHERE id=? AND mutation_token=?)',
      p.id,
      p.id,
      token,
    ),
  ];
  for (const [i, person] of body.characters.entries()) {
    const previous = old.find((x) => x.id === person.id);
    const provenance = previous?.description === person.description ? previous.provenance : 'user';
    queries.push(
      statement(
        c.env,
        'INSERT INTO characters(id,project_id,ordinal,source_asset_id,name,description,provenance,crop,framing) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND mutation_token=?)',
        person.id,
        p.id,
        i,
        person.sourceAssetId,
        person.name,
        person.description,
        provenance,
        JSON.stringify(person.crop),
        person.framing,
        p.id,
        token,
      ),
    );
  }
  const results = await c.env.DB.batch(queries);
  if (!results[0].meta.changes)
    throw new AppError(409, 'revision', 'This setup changed. Reload it before saving again.');
  if (body.preset !== p.preset) await recordEvent(c.env, 'preset_selected', p.id, body.preset);
  if (
    body.characters.some(
      (c) => c.description && old.find((o) => o.id === c.id)?.description !== c.description,
    )
  )
    await recordEvent(c.env, 'custom_description_saved', p.id, body.preset);
  return c.json({ ...(await view(c.env, await project(c.env, p.id))), revision });
});
drafts.post('/projects/:id/uploads', async (c) => {
  const p = await owned(c);
  draft(p);
  const body = uploadSchema.parse(await c.req.json());
  const id = crypto.randomUUID();
  const r = await statement(
    c.env,
    `INSERT INTO upload_tickets(id,project_id,mime,size,expires_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM upload_tickets WHERE project_id=?) < 30`,
    id,
    p.id,
    body.mime,
    body.size,
    Date.now() + 10 * 60000,
    p.id,
  ).run();
  if (!r.meta.changes)
    throw new AppError(
      429,
      'uploads',
      'This draft has reached its upload limit. Start a fresh cartoon.',
    );
  await recordEvent(c.env, 'upload_started', p.id);
  return c.json({ uploadUrl: `/api/projects/${p.id}/uploads/${id}` }, 201);
});
drafts.put('/projects/:id/uploads/:ticket', async (c) => {
  const p = await owned(c);
  draft(p);
  const t = await statement(
    c.env,
    'SELECT * FROM upload_tickets WHERE id=? AND project_id=? AND expires_at>?',
    c.req.param('ticket'),
    p.id,
    Date.now(),
  ).first<{ id: string; mime: string; size: number; state: string; asset_id: string | null }>();
  if (!t) throw new AppError(404, 'upload', 'This upload expired. Select the photo again.');
  if (t.state === 'complete') return c.json({ assetId: t.asset_id });
  const claim = await statement(
    c.env,
    "UPDATE upload_tickets SET state='processing' WHERE id=? AND state='pending'",
    t.id,
  ).run();
  if (!claim.meta.changes)
    throw new AppError(409, 'upload', 'This upload is already being processed.');
  try {
    let bytes = await boundedBody(c.req.raw, 15 * 1024 * 1024);
    if (bytes.length !== t.size || c.req.header('Content-Type') !== t.mime)
      throw new AppError(400, 'upload', 'The file doesn’t match its upload authorization.');
    const dimensions = imageSize(bytes);
    const mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[dimensions.type ?? ''];
    if (!mime || mime !== t.mime)
      throw new AppError(
        415,
        'format',
        'Use a JPEG, PNG or WebP photo. Convert HEIC using your Photos app first.',
      );
    if (
      !dimensions.width ||
      !dimensions.height ||
      dimensions.width * dimensions.height > 40_000_000
    )
      throw new AppError(413, 'dimensions', 'Choose a photo under 40 megapixels.');
    let width = dimensions.width;
    let height = dimensions.height;
    let outputMime = mime;
    if (c.env.MODE === 'real') {
      if (!('RENDERER' in c.env))
        throw new AppError(503, 'upload', 'Photo processing is unavailable.');
      const reservation = `processing:${t.id}`;
      await reserve(c.env, p.id, reservation, usdMicros(c.env.PROCESSING_COST_USD));
      const normalized = await c.env.RENDERER.getByName(NATIVE_INSPECTOR).fetch(
        new Request('http://renderer/normalize', {
          method: 'POST',
          body: bytes.slice().buffer,
          headers: { 'content-type': mime },
        }),
      );
      await settle(c.env, reservation);
      if (normalized.status >= 500 || normalized.status === 429) {
        console.warn(
          JSON.stringify({
            event: 'native_processing_unavailable',
            operation: 'normalize',
            status: normalized.status,
          }),
        );
        throw new AppError(
          503,
          'processing',
          'Photo processing is warming up. Try again in a moment.',
        );
      }
      if (!normalized.ok)
        throw new AppError(
          422,
          'portrait',
          'This photo couldn’t be decoded safely. Try a different individual portrait.',
        );
      bytes = await boundedBody(normalized, 15 * 1024 * 1024);
      width = Number(normalized.headers.get('x-width'));
      height = Number(normalized.headers.get('x-height'));
      outputMime = 'image/jpeg';
    }
    const id = await saveAsset(c.env, p.id, 'source', bytes, outputMime, { width, height });
    await statement(
      c.env,
      "UPDATE upload_tickets SET state='complete',asset_id=? WHERE id=?",
      id,
      t.id,
    ).run();
    await recordEvent(c.env, 'upload_completed', p.id);
    return c.json({ assetId: id, width, height }, 201);
  } catch (e) {
    await statement(c.env, "UPDATE upload_tickets SET state='failed' WHERE id=?", t.id).run();
    throw e;
  }
});
drafts.post('/projects/:id/character-descriptions', async (c) => {
  const p = await owned(c);
  draft(p);
  const input = descriptionsSchema.parse(await c.req.json());
  if (new Set(input.characterIds).size !== input.characterIds.length)
    throw new AppError(400, 'characters', 'Choose distinct characters.');
  const cast = await characters(c.env, p.id);
  if (input.characterIds.some((id) => !cast.some((c) => c.id === id)))
    throw new AppError(400, 'characters', 'Choose characters from this cartoon.');
  const ids = input.characterIds.filter(
    (id) => !input.onlyEmpty || !cast.find((c) => c.id === id)!.description.trim(),
  );
  if (!ids.length) return c.json(await view(c.env, p));
  const claim = await statement(
    c.env,
    "UPDATE projects SET description_busy=1, description_requests=description_requests+1, revision=revision+1 WHERE id=? AND state='draft' AND revision=? AND description_busy=0 AND description_requests<?",
    p.id,
    p.revision,
    Number(c.env.MAX_DESCRIPTION_REQUESTS),
  ).run();
  if (!claim.meta.changes)
    throw new AppError(
      429,
      'descriptions',
      'The automatic description limit is reached or a request is already running. You can still type your own.',
    );
  await recordEvent(c.env, 'description_requested', p.id, p.preset, ids.length);
  try {
    const results = await generateDescriptions(
      c.env,
      p.id,
      ids,
      p.preset,
      cast.map((c) => c.description).filter(Boolean),
      (p.seed + p.description_requests) >>> 0,
    );
    await c.env.DB.batch(
      results.map((r) =>
        statement(
          c.env,
          "UPDATE characters SET description=?,provenance='llm' WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM projects WHERE id=? AND state='draft' AND description_busy=1)",
          r.description,
          r.id,
          p.id,
          p.id,
        ),
      ),
    );
    await recordEvent(c.env, 'description_completed', p.id, p.preset, results.length);
  } catch (e) {
    await recordEvent(c.env, 'description_failed', p.id, p.preset);
    throw e;
  } finally {
    await statement(
      c.env,
      'UPDATE projects SET description_busy=0,updated_at=? WHERE id=?',
      Date.now(),
      p.id,
    ).run();
  }
  return c.json(await view(c.env, await project(c.env, p.id)));
});
drafts.get('/projects/:id/assets/:asset', async (c) => {
  const p = await owned(c);
  const a = await statement(
    c.env,
    'SELECT * FROM assets WHERE id=? AND project_id=? AND expires_at>?',
    c.req.param('asset'),
    p.id,
    Date.now(),
  ).first<AssetRow>();
  if (!a) throw new AppError(404, 'asset', 'This artwork is no longer available.');
  return serveAsset(c.env, a, c.req.raw, c.req.query('download') === '1' && a.kind === 'video');
});
const eventSchema = z
  .object({
    name: z.enum([
      'playback_started',
      'replayed',
      'download_requested',
      'create_from_share',
      'replacement_requested',
    ]),
    value: z.number().min(0).max(6).optional(),
  })
  .strict();
drafts.post('/projects/:id/events', async (c) => {
  const p = await owned(c);
  const e = eventSchema.parse(await c.req.json());
  await recordEvent(c.env, e.name, p.id, p.preset, e.value ?? null);
  return c.json({ ok: true });
});
// Deliberately no scene-retry, regeneration, arbitrary remote-upload or model-selection routes.
