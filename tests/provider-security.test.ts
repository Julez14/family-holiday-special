import type { AppEnv } from '../src/server/env';
import { it, expect, vi } from 'vitest';
import { verifyFalSignature, outputUrl, falInput, FalQueue } from '../src/server/fal';
import { sign, verifyHmac, sha256 } from '../src/server/crypto';
import { validateDescriptions } from '../src/server/descriptions';
it('verifies authentic Ed25519 callbacks and rejects tampering, wrong accounts and stale deliveries', async () => {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const body = new TextEncoder().encode('{"request_id":"request-123","status":"OK"}');
  const time = String(Math.floor(Date.now() / 1000));
  const message = new TextEncoder().encode(
    ['request-123', 'user-456', time, await sha256(body)].join('\n'),
  );
  const sig = Array.from(
    new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, message)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  const h = new Headers({
    'x-fal-webhook-request-id': 'request-123',
    'x-fal-webhook-user-id': 'user-456',
    'x-fal-webhook-timestamp': time,
    'x-fal-webhook-signature': sig,
  });
  expect(await verifyFalSignature(h, body, [jwk], 'user-456')).toBe(true);
  expect(await verifyFalSignature(h, new TextEncoder().encode('{}'), [jwk], 'user-456')).toBe(
    false,
  );
  expect(await verifyFalSignature(h, body, [jwk], 'other-user')).toBe(false);
  expect(await verifyFalSignature(h, body, [jwk], 'user-456', Date.now() + 301000)).toBe(false);
});
it('scopes reference signatures to exact assets and times', async () => {
  const data = 'read:project:a:123';
  const signature = await sign('test-secret', data);
  expect(await verifyHmac('test-secret', data, signature)).toBe(true);
  expect(await verifyHmac('test-secret', 'read:project:b:123', signature)).toBe(false);
});
it('blocks arbitrary output hosts, credentials and non-HTTPS output URLs', () => {
  for (const url of [
    'http://fal.media/a',
    'https://fal.media.evil.test/a',
    'https://evil.test/a',
    'https://me:secret@fal.media/a',
    'https://fal.media:444/a',
  ])
    expect(() => outputUrl('video', { video: { url } }, ['fal.media'])).toThrow();
  expect(outputUrl('video', { video: { url: 'https://v3b.fal.media/a' } }, ['fal.media'])).toBe(
    'https://v3b.fal.media/a',
  );
});
it('uses only the checked H3 input contract and refuses model-name-only substitution', () => {
  const input = {
    kind: 'video' as const,
    input: {
      prompt: 'No dialogue',
      frameUrl: 'https://a.test/frame',
      referenceUrls: ['https://a.test/cast'],
      seed: 1,
    },
  };
  expect(falInput('minimax/h3-max/reference-to-video', input)).toMatchObject({
    duration: 5,
    prompt_expansion_mode: 'disabled',
    enable_safety_checker: true,
  });
  expect(() => falInput('kling/v4/reference-to-video', input)).toThrow();
});
it('validates exact requested description IDs, length, variety and editable plain text', () => {
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  expect(
    validateDescriptions(
      { descriptions: ids.map((id, i) => ({ id, description: `A tiny victory dance ${i}.` })) },
      ids,
    ),
  ).toHaveLength(2);
  for (const descriptions of [
    [{ id: ids[0], description: 'x' }],
    ids.map((id) => ({ id, description: 'duplicate' })),
    ids.map((id) => ({ id, description: 'x'.repeat(501) })),
  ])
    expect(() => validateDescriptions({ descriptions }, ids)).toThrow();
});

it('keeps provider execution metrics distinct from observed queue timestamps', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'IN_PROGRESS' })));
  const queue = new FalQueue({ FAL_KEY: 'unused-test-key' } as AppEnv);
  try {
    expect(await queue.poll('minimax/h3-max/reference-to-video', 'known-request')).toMatchObject({
      state: 'pending',
      providerState: 'IN_PROGRESS',
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'COMPLETED', metrics: { inference_time: 12.5 } })),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ video: { url: 'https://v3.fal.media/test.mp4' } })),
    );
    expect(await queue.poll('minimax/h3-max/reference-to-video', 'known-request')).toMatchObject({
      state: 'completed',
      providerState: 'COMPLETED',
      inferenceMs: 12500,
    });
  } finally {
    fetchMock.mockRestore();
  }
});
