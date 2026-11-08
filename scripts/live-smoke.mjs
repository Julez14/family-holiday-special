// Explicitly paid, dev-only integration test using a code-drawn source portrait.
// Usage: node scripts/live-smoke.mjs --allow-paid (then --status to resume polling).
// State, owner cookie and resulting media stay under ignored .wrangler/live-smoke/.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
const origin = 'https://family-holiday-special-dev.juelzlax.workers.dev';
const folder = '.wrangler/live-smoke';
const statusOnly = process.argv.includes('--status');
if (!statusOnly && !process.argv.includes('--allow-paid'))
  throw new Error(
    'Pass --allow-paid to explicitly start paid inference, or --status to inspect an existing job.',
  );
await mkdir(folder, { recursive: true });
const operatorSecret = (await readFile('.wrangler/dev-operator-secret', 'utf8')).trim();
let state;
try {
  state = JSON.parse(await readFile(`${folder}/state.json`, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  state = { idempotencyKey: randomUUID(), cookie: '' };
}
const save = () => writeFile(`${folder}/state.json`, JSON.stringify(state), { mode: 0o600 });
async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const url = new URL(path, origin);
  const time = String(Math.floor(Date.now() / 1000));
  const result = await fetch(new URL(path, origin), {
    method,
    body,
    headers: {
      origin,
      cookie: state.cookie,
      ...(typeof body === 'string' ? { 'content-type': 'application/json' } : {}),
      ...headers,
      'X-Dev-Local-Time': time,
      'X-Dev-Local-Signature': createHmac('sha256', operatorSecret)
        .update(`local-dev-v1:${method}:${url.pathname + url.search}:${time}`)
        .digest('hex'),
    },
    signal: AbortSignal.timeout(180000),
  });
  if (result.headers.get('set-cookie')) {
    state.cookie = result.headers.get('set-cookie').split(';')[0];
    await save();
  }
  if (!result.ok) {
    let error;
    try {
      error = await result.json();
    } catch {
      error = {};
    }
    throw new Error(
      `${method} ${path}: ${result.status} ${error.code ?? ''} ${error.message ?? ''}`,
    );
  }
  return result;
}
const config = await (await call('/api/config')).json();
if (config.mode !== 'real' || config.releaseChannel !== 'dev')
  throw new Error('Paid dev deployment required.');
if (process.argv.includes('--fresh')) {
  if (statusOnly) throw new Error('Use --fresh with --allow-paid, not --status.');
  if (state.projectId) {
    if (!/^[a-f0-9-]{36}$/.test(state.projectId)) throw new Error('Invalid saved project ID.');
    const previous = await (await call(`/api/projects/${state.projectId}`)).json();
    if (previous.state !== 'ready')
      throw new Error('A fresh test requires the previous job to finish successfully.');
    const archive = `${folder}/archive/${state.projectId}`;
    await mkdir(archive, { recursive: true });
    await writeFile(`${archive}/state.json`, JSON.stringify(state), { mode: 0o600 });
    for (const name of ['video.mp4', 'poster.jpg'])
      await copyFile(`${folder}/${name}`, `${archive}/${name}`);
    state = { idempotencyKey: randomUUID(), cookie: state.cookie };
    await save();
  }
}
if (!statusOnly) {
  if (!state.projectId) {
    const p = await (await call('/api/projects', { method: 'POST', body: '{}' })).json();
    state.projectId = p.id;
    await save();
  }
  let p = await (await call(`/api/projects/${state.projectId}`)).json();
  if (p.state === 'draft' && !p.characters.length) {
    const source = await readFile('public/fixtures/portrait-1.png');
    const ticket = await (
      await call(`/api/projects/${p.id}/uploads`, {
        method: 'POST',
        body: JSON.stringify({ mime: 'image/png', size: source.byteLength }),
      })
    ).json();
    const upload = await (
      await call(ticket.uploadUrl, {
        method: 'PUT',
        body: source,
        headers: { 'content-type': 'image/png' },
      })
    ).json();
    p = await (
      await call(`/api/projects/${p.id}/cast`, {
        method: 'PATCH',
        body: JSON.stringify({
          revision: p.revision,
          preset: 'snowball',
          characters: [
            {
              id: randomUUID(),
              sourceAssetId: upload.assetId,
              name: 'Illustrated test character',
              description: '',
              provenance: 'user',
              framing: 'manual',
              crop: { x: 0.18, y: 0.05, width: 0.65, height: 0.5 },
            },
          ],
        }),
      })
    ).json();
  }
  if (p.state === 'draft' && !p.characters[0]?.description) {
    p = await (
      await call(`/api/projects/${p.id}/character-descriptions`, {
        method: 'POST',
        body: JSON.stringify({ characterIds: p.characters.map((c) => c.id), onlyEmpty: true }),
      })
    ).json();
    console.log('Workers AI: returned validated descriptions for the requested character IDs.');
  }
  if (p.state === 'draft') {
    const secret = (await readFile('.wrangler/dev-operator-secret', 'utf8')).trim();
    const time = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', secret)
      .update(`dev-generate:${p.id}:${state.idempotencyKey}:${time}`)
      .digest('hex');
    const job = await (
      await call(`/api/projects/${p.id}/generate`, {
        method: 'POST',
        body: '{}',
        headers: {
          'Idempotency-Key': state.idempotencyKey,
          'X-Dev-Generation-Time': time,
          'X-Dev-Generation-Signature': signature,
        },
      })
    ).json();
    state.jobId = job.jobId;
    await save();
    console.log(JSON.stringify({ projectId: p.id, jobId: job.jobId }));
  }
}
if (!state.projectId) throw new Error('No paid smoke test has been started.');
let previous = '';
for (let i = 0; i < 60; i++) {
  const p = await (await call(`/api/projects/${state.projectId}`)).json();
  const summary = JSON.stringify({
    state: p.state,
    portraits: p.characters.filter((c) => c.canonicalUrl).length,
    frames: p.shots.filter((s) => s.frameUrl).length,
    clips: p.shots.filter((s) => s.clipReady).length,
    reservedEstimateUsd: p.costEstimateUsd,
    ...(p.error ? { error: p.error } : {}),
  });
  if (summary !== previous) console.log(summary);
  previous = summary;
  if (p.state === 'failed') {
    process.exitCode = 1;
    break;
  }
  if (p.state === 'ready') {
    for (const [kind, path] of [
      ['video.mp4', p.videoUrl],
      ['poster.jpg', p.posterUrl],
    ]) {
      const media = await call(path);
      await writeFile(`${folder}/${kind}`, new Uint8Array(await media.arrayBuffer()));
    }
    console.log('Saved ready MP4 and poster under .wrangler/live-smoke/.');
    break;
  }
  if (i === 59)
    console.log(
      'Still running. Resume the same job with --status; no new paid submissions are created.',
    );
  else await new Promise((resolve) => setTimeout(resolve, 10000));
}
