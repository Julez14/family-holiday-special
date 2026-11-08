import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import assert from 'node:assert/strict';
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
const origin = 'http://localhost:8791';
assert.match(
  await readFile('wrangler.jsonc', 'utf8'),
  /"MODE"\s*:\s*"mock"/,
  'Scenario checks only run against mock configuration.',
);
const scenarios = [
  ['callback-before-save', 'ready'],
  ['missing-callback', 'ready'],
  ['failed-scene', 'ready'],
  ['submission-unknown', 'failed'],
  ['exhausted-retries', 'failed'],
  ['rejection', 'failed'],
];
for (const [scenario, expected] of scenarios) {
  const storage = await mkdtemp(join(tmpdir(), 'holiday-scenario-'));
  const run = (args) =>
    execFileSync(process.execPath, [wrangler, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  let child;
  try {
    run(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', storage]);
    child = spawn(
      process.execPath,
      [
        wrangler,
        'dev',
        '--port',
        '8791',
        '--persist-to',
        storage,
        '--var',
        'MODE:mock',
        '--var',
        `APP_ORIGIN:${origin}`,
        '--var',
        `MOCK_SCENARIO:${scenario}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let diagnostics = '';
    child.stdout.on('data', (d) => {
      diagnostics = (diagnostics + d).slice(-4000);
    });
    child.stderr.on('data', (d) => {
      diagnostics = (diagnostics + d).slice(-4000);
    });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(origin + '/api/health')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await pause(250);
    }
    assert(ready, `Local scenario server did not start: ${diagnostics}`);
    let cookie = '';
    const request = async (path, method = 'GET', body, extra = {}) => {
      const r = await fetch(origin + path, {
        method,
        headers: {
          Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
          ...extra,
        },
        body,
      });
      assert(r.ok, `${scenario}: ${method} ${path} -> ${r.status}`);
      return r;
    };
    const created = await request('/api/projects', 'POST', '{}');
    cookie = created.headers.get('set-cookie').split(';')[0];
    let project = await created.json();
    const cast = [];
    for (let n = 1; n <= 2; n++) {
      const bytes = await readFile(`public/fixtures/portrait-${n}.png`);
      const ticket = await (
        await request(
          `/api/projects/${project.id}/uploads`,
          'POST',
          JSON.stringify({ mime: 'image/png', size: bytes.length }),
        )
      ).json();
      const upload = await (
        await request(ticket.uploadUrl, 'PUT', bytes, { 'Content-Type': 'image/png' })
      ).json();
      cast.push({
        id: crypto.randomUUID(),
        sourceAssetId: upload.assetId,
        name: '',
        description: `A tiny proud victory wiggle number ${n}.`,
        provenance: 'user',
        crop: { x: 0, y: 0, width: 1, height: 1 },
        framing: 'manual',
      });
    }
    await request(
      `/api/projects/${project.id}/cast`,
      'PATCH',
      JSON.stringify({ revision: project.revision, preset: 'snowball', characters: cast }),
    );
    await request(`/api/projects/${project.id}/generate`, 'POST', '{}', {
      'Idempotency-Key': crypto.randomUUID(),
    });
    for (let i = 0; i < 100; i++) {
      project = await (await request(`/api/projects/${project.id}`)).json();
      if (['ready', 'failed'].includes(project.state)) break;
      await pause(200);
    }
    assert.equal(
      project.state,
      expected,
      `${scenario}: ${project.error ?? 'Unexpected terminal state'}`,
    );
    const query = (sql) =>
      JSON.parse(
        run([
          'd1',
          'execute',
          'DB',
          '--local',
          '--persist-to',
          storage,
          '--json',
          '--command',
          sql,
        ]),
      )[0].results;
    const attempts = query('SELECT stage,state,revision,request_id FROM attempts');
    if (scenario === 'failed-scene') {
      assert.equal(attempts.filter((a) => a.stage === 'video').length, 5);
      assert.equal(attempts.filter((a) => a.stage === 'video' && a.state === 'accepted').length, 4);
      assert.equal(
        attempts.filter((a) => a.stage === 'image').length,
        6,
        'Successful images must not be regenerated',
      );
    }
    if (scenario === 'submission-unknown') {
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].state, 'submission_unknown');
      assert.equal(attempts[0].request_id, null);
      assert.equal(
        query("SELECT COUNT(*) AS n FROM reservations WHERE state='reserved'")[0].n,
        1,
        'Unknown submissions retain spend',
      );
    }
    if (scenario === 'exhausted-retries') {
      assert(attempts.filter((a) => a.stage === 'video').length <= 5);
      assert.equal(attempts.filter((a) => a.stage === 'video' && a.revision > 0).length, 1);
    }
    if (scenario === 'rejection') {
      assert.equal(attempts.length, 1);
      assert(project.error.includes('couldn’t accept'));
    }
    console.log(`${scenario}: ${project.state}, ${attempts.length} attempts — passed`);
  } finally {
    if (child) {
      child.kill('SIGINT');
      await Promise.race([
        new Promise((r) => child.once('exit', r)),
        pause(5000).then(() => child.kill('SIGKILL')),
      ]);
    }
    await rm(storage, { recursive: true, force: true });
  }
}
