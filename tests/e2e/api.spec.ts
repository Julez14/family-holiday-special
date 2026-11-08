import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { CharacterInput, ProjectView } from '../../src/shared/contracts';
const origin = 'https://localhost:8790';
async function create(client: APIRequestContext) {
  const response = await client.post('/api/projects', { data: {}, headers: { Origin: origin } });
  expect(response.ok()).toBeTruthy();
  const p: ProjectView = await response.json();
  const cookie = response.headers()['set-cookie']?.split(';')[0];
  expect(cookie).toBeTruthy();
  return { p, headers: { Origin: origin, Cookie: cookie! } };
}
async function source(
  client: APIRequestContext,
  id: string,
  headers: Record<string, string>,
  n: number,
) {
  const bytes = await readFile(new URL(`../../public/fixtures/portrait-${n}.png`, import.meta.url));
  const ticket = await client.post(`/api/projects/${id}/uploads`, {
    data: { mime: 'image/png', size: bytes.length },
    headers,
  });
  expect(ticket.status()).toBe(201);
  const { uploadUrl } = await ticket.json();
  const r = await client.put(uploadUrl, {
    data: bytes,
    headers: { ...headers, 'Content-Type': 'image/png' },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).assetId as string;
}
function person(assetId: string, description = ''): CharacterInput {
  return {
    id: crypto.randomUUID(),
    sourceAssetId: assetId,
    name: '',
    description,
    provenance: 'user',
    crop: { x: 0, y: 0, width: 1, height: 1 },
    framing: 'manual',
  };
}

test('persistent setup, scoped descriptions, one generation job, private sources, ranges, sharing and deletion', async ({
  request,
  playwright,
}) => {
  const { p, headers } = await create(request);
  let current = p;
  const cast = [
    person(await source(request, p.id, headers, 1), 'A carefully saved custom victory dance.'),
    person(await source(request, p.id, headers, 2)),
  ];
  const save = await request.patch(`/api/projects/${p.id}/cast`, {
    data: { revision: p.revision, preset: 'snowball', characters: cast },
    headers,
  });
  expect(save.ok()).toBeTruthy();
  current = await save.json();
  const description = await request.post(`/api/projects/${p.id}/character-descriptions`, {
    data: { characterIds: cast.map((c) => c.id), onlyEmpty: true },
    headers,
  });
  expect(description.ok()).toBeTruthy();
  current = await description.json();
  expect(current.characters[0].description).toBe(cast[0].description);
  expect(current.characters[1].description.length).toBeGreaterThan(5);
  expect(current.state).toBe('draft');
  const secondText = current.characters[1].description;
  const single = await request.post(`/api/projects/${p.id}/character-descriptions`, {
    data: { characterIds: [cast[0].id], onlyEmpty: false },
    headers,
  });
  expect(single.ok()).toBeTruthy();
  current = await single.json();
  expect(current.characters[1].description).toBe(secondText);
  expect(current.characters[0].description).not.toBe(cast[0].description);
  const reloaded = await request.get(`/api/projects/${p.id}`, { headers });
  expect((await reloaded.json()).characters).toEqual(current.characters);
  const foreign = await playwright.request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  expect((await foreign.get(`/api/projects/${p.id}`)).status()).toBe(401);
  expect((await foreign.get(current.characters[0].sourceUrl)).status()).toBe(401);
  const key = crypto.randomUUID();
  const receipts = await Promise.all(
    [1, 2].map(() =>
      request.post(`/api/projects/${p.id}/generate`, {
        data: {},
        headers: { ...headers, 'Idempotency-Key': key },
      }),
    ),
  );
  for (const r of receipts) expect(r.status()).toBe(202);
  expect((await receipts[0].json()).jobId).toBe((await receipts[1].json()).jobId);
  expect(
    (
      await request.patch(`/api/projects/${p.id}/cast`, {
        data: { revision: current.revision, preset: 'giftwrap', characters: cast },
        headers,
      })
    ).status(),
  ).toBe(409);
  expect(
    (await request.post(`/api/projects/${p.id}/shots/1/retry`, { data: {}, headers })).status(),
  ).toBe(404);
  await expect
    .poll(
      async () => {
        current = await (await request.get(`/api/projects/${p.id}`, { headers })).json();
        return current.state;
      },
      { timeout: 45000 },
    )
    .toBe('ready');
  expect(current.shots.filter((s) => s.clipReady)).toHaveLength(4);
  expect(current.characters.every((c) => c.canonicalUrl)).toBe(true);
  expect(current.expiresAt).toBeGreaterThanOrEqual(Date.parse('2027-02-01T05:00:00Z'));
  const shared = await request.post(`/api/projects/${p.id}/share`, { data: {}, headers });
  expect(shared.ok()).toBeTruthy();
  const { url } = await shared.json();
  const repeated = await request.post(`/api/projects/${p.id}/share`, { data: {}, headers });
  expect((await repeated.json()).url).toBe(url);
  const landing = await foreign.get(url);
  expect(landing.status()).toBe(200);
  const html = await landing.text();
  expect(html).toContain(`content="${url}/poster"`);
  expect(html).not.toContain(cast[0].description);
  expect(html).not.toContain('sourceAssetId');
  expect(
    (
      await foreign.post(`${url}/events`, {
        headers: { Origin: origin },
        data: { name: 'recipient_playback_started' },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await foreign.post(`${url}/events`, {
        headers: { Origin: 'https://evil.test' },
        data: { name: 'recipient_playback_started' },
      })
    ).status(),
  ).toBe(403);
  const video = await foreign.get(`${url}/media`, { headers: { Range: 'bytes=0-99' } });
  expect(video.status()).toBe(206);
  expect((await video.body()).length).toBe(100);
  expect(video.headers()['content-range']).toMatch(/^bytes 0-99\//);
  expect(video.headers()['cache-control']).toContain('no-store');
  const suffix = await foreign.get(`${url}/media`, { headers: { Range: 'bytes=-32' } });
  expect(suffix.status()).toBe(206);
  expect((await suffix.body()).length).toBe(32);
  expect(
    (await foreign.get(`${url}/media`, { headers: { Range: 'bytes=9999999999-' } })).status(),
  ).toBe(416);
  expect((await foreign.get(`${url}/poster`)).status()).toBe(200);
  expect(
    (await foreign.delete(`/api/projects/${p.id}`, { headers: { Origin: origin } })).status(),
  ).toBe(401);
  expect((await request.delete(`/api/projects/${p.id}`, { headers })).status()).toBe(202);
  expect((await foreign.get(`${url}/media`)).status()).toBe(404);
  expect((await foreign.get(url)).status()).toBe(404);
  await foreign.dispose();
});

test('rejects CSRF, foreign assets, seventh cast member, invalid crops and unknown generation fields', async ({
  request,
  playwright,
}) => {
  expect(
    (
      await request.post('/api/projects', { data: {}, headers: { Origin: 'https://evil.test' } })
    ).status(),
  ).toBe(403);
  const { p, headers } = await create(request);
  const asset = await source(request, p.id, headers, 3);
  const cast = person(asset, 'x'.repeat(500));
  const other = await playwright.request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const foreign = await create(other);
  const foreignAsset = await source(other, foreign.p.id, foreign.headers, 4);
  const patch = (characters: unknown[]) =>
    request.patch(`/api/projects/${p.id}/cast`, {
      data: { revision: p.revision, preset: 'giftwrap', characters },
      headers,
    });
  expect((await patch([{ ...cast, sourceAssetId: foreignAsset }])).status()).toBe(400);
  expect((await patch([{ ...cast, crop: { x: 0.9, y: 0, width: 0.3, height: 1 } }])).status()).toBe(
    400,
  );
  expect(
    (await patch(Array.from({ length: 7 }, () => ({ ...cast, id: crypto.randomUUID() })))).status(),
  ).toBe(400);
  expect((await patch([{ ...cast, description: 'x'.repeat(501) }])).status()).toBe(400);
  expect((await patch([cast])).status()).toBe(200);
  expect(
    (
      await request.post(`/api/projects/${p.id}/generate`, {
        data: { model: 'arbitrary' },
        headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post('/api/fal/webhook', { data: { request_id: 'forged', status: 'OK' } })
    ).status(),
  ).toBe(403);
  await request.delete(`/api/projects/${p.id}`, { headers });
  await other.delete(`/api/projects/${foreign.p.id}`, { headers: foreign.headers });
  await other.dispose();
});
