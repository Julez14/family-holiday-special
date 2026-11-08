import type { AppEnv } from '../src/server/env';
import { it, expect, vi } from 'vitest';
import {
  verifyFalSignature,
  outputUrl,
  falInput,
  FalQueue,
  callbackFailureCategory,
} from '../src/server/fal';
import { sign, verifyHmac, sha256 } from '../src/server/crypto';
import { validateDescriptions } from '../src/server/descriptions';
import { AppError, workflowAppErrorCode, errorMessage } from '../src/server/errors';
import { providerFailureCategory, isModerationFailure } from '../src/shared/provider-errors';

const moderation = {
  detail: [
    {
      type: 'content_policy_violation',
      categories: ['model_moderated'],
      msg: 'private provider text',
    },
  ],
};
it('classifies explicit moderation codes without inferring them from input or messages', () => {
  expect(providerFailureCategory(moderation)).toBe('content_policy_violation:model_moderated');
  expect(providerFailureCategory({ error: { code: 'model_moderated' } })).toBe('model_moderated');
  expect(providerFailureCategory(null, JSON.stringify(moderation))).toBe(
    'content_policy_violation:model_moderated',
  );
  expect(
    providerFailureCategory({
      detail: [{ type: 'invalid_image', msg: 'model_moderated' }],
      input: { type: 'content_policy_violation' },
    }),
  ).toBe('provider_rejected');
  expect(providerFailureCategory('Invalid status code: 422')).toBe('provider_rejected');
  for (const code of [
    'content_policy_violation',
    'model_moderated',
    'content_policy_violation:model_moderated',
  ]) {
    expect(isModerationFailure(code)).toBe(true);
    expect(errorMessage(code)).toContain('AI provider blocked');
    expect(errorMessage(code)).toContain('exact trigger');
    expect(errorMessage(code)).not.toContain('private provider text');
  }
});

it('preserves moderation on direct rejection and polling while keeping validation errors generic', async () => {
  const queue = new FalQueue({
    FAL_KEY: 'test',
    APP_ORIGIN: 'https://studio.test',
    ASSET_SIGNING_SECRET: 'x'.repeat(64),
  } as AppEnv);
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  try {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(moderation), { status: 422 }));
    await expect(
      queue.submit(
        'openai/gpt-image-2.6/flare/edit',
        { kind: 'image', input: { prompt: 'test', referenceUrls: [], portrait: true } },
        'attempt',
      ),
    ).rejects.toMatchObject({ category: 'content_policy_violation:model_moderated' });
    fetchMock.mockResolvedValueOnce(new Response('{"status":"COMPLETED"}'));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(moderation), { status: 422 }));
    expect(await queue.poll('openai/gpt-image-2.6/flare/edit', 'known-receipt')).toMatchObject({
      state: 'failed',
      category: 'content_policy_violation:model_moderated',
    });
    fetchMock.mockResolvedValueOnce(new Response('{"status":"COMPLETED"}'));
    fetchMock.mockResolvedValueOnce(
      new Response('{"detail":[{"type":"invalid_image"}]}', { status: 422 }),
    );
    expect(await queue.poll('openai/gpt-image-2.6/flare/edit', 'known-receipt')).toMatchObject({
      state: 'failed',
      category: 'provider_rejected',
    });
  } finally {
    fetchMock.mockRestore();
  }
});
import { authorizedLocalDevRequest } from '../src/server/dev-operator';
import { localDevMessage } from '../src/shared/local-dev';

it('limits local proxy credentials to real dev, exact requests and fresh timestamps', async () => {
  const secret = 'dev-only-test-secret'.repeat(4);
  const env = {
    MODE: 'real',
    RELEASE_CHANNEL: 'dev',
    LOCAL_DEV_ONLY: 'true',
    DEV_OPERATOR_SECRET: secret,
  } as AppEnv;
  const time = String(Math.floor(Date.now() / 1000));
  const path = '/api/projects/example?version=1';
  const headers = {
    'X-Dev-Local-Time': time,
    'X-Dev-Local-Signature': await sign(secret, localDevMessage('GET', path, time)),
  };
  const request = new Request(`https://dev.test${path}`, { headers });
  expect(await authorizedLocalDevRequest(env, request)).toBe(true);
  expect(
    await authorizedLocalDevRequest(
      env,
      new Request('https://dev.test/api/projects/other', { headers }),
    ),
  ).toBe(false);
  expect(
    await authorizedLocalDevRequest(
      env,
      new Request(`https://dev.test${path}`, { method: 'DELETE', headers }),
    ),
  ).toBe(false);
  expect(await authorizedLocalDevRequest(env, request, Date.now() + 61000)).toBe(false);
  expect(await authorizedLocalDevRequest({ ...env, MODE: 'mock' } as AppEnv, request)).toBe(false);
  expect(
    await authorizedLocalDevRequest({ ...env, RELEASE_CHANNEL: 'main' } as AppEnv, request),
  ).toBe(false);
  expect(
    await authorizedLocalDevRequest({ ...env, LOCAL_DEV_ONLY: 'false' } as AppEnv, request),
  ).toBe(false);
  expect(
    await authorizedLocalDevRequest({ ...env, DEV_OPERATOR_SECRET: 'wrong'.repeat(16) }, request),
  ).toBe(false);
  expect(await authorizedLocalDevRequest(env, new Request(request.url))).toBe(false);
});

it('preserves known failure categories across serialized Workflow step errors', () => {
  expect(workflowAppErrorCode(new AppError(503, 'processing', 'Unavailable.'))).toBe('processing');
  for (const code of ['budget', 'processing', 'unavailable']) {
    expect(workflowAppErrorCode(new Error(`AppError:${code}: stopped`))).toBe(code);
    const renamed = new Error('stopped');
    renamed.name = `AppError:${code}`;
    expect(workflowAppErrorCode(renamed)).toBe(code);
  }
  expect(workflowAppErrorCode(new Error('Unexpected provider failure'))).toBeUndefined();
  expect(workflowAppErrorCode(new Error('AppError:processing_extra: stopped'))).toBeUndefined();
  expect(workflowAppErrorCode('AppError:processing')).toBeUndefined();
});
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

it('recovers sparse callback moderation details using GETs on the same receipt, with no resubmission', async () => {
  const env = { FAL_KEY: 'test' } as AppEnv;
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  try {
    expect(
      await callbackFailureCategory(
        env,
        'openai/gpt-image-2.6/flare/edit',
        'receipt',
        JSON.stringify({ category: 'model_moderated' }),
      ),
    ).toBe('model_moderated');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(new Response('{"status":"COMPLETED"}'));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(moderation), { status: 422 }));
    expect(
      await callbackFailureCategory(env, 'openai/gpt-image-2.6/flare/edit', 'receipt', 'null'),
    ).toBe('content_policy_violation:model_moderated');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.every(
        ([url, init]) =>
          String(url).includes('/requests/receipt') && (!init?.method || init.method === 'GET'),
      ),
    ).toBe(true);
    fetchMock.mockRejectedValueOnce(new Error('temporary outage'));
    expect(
      await callbackFailureCategory(env, 'openai/gpt-image-2.6/flare/edit', 'receipt', null),
    ).toBe('provider_rejected');
  } finally {
    fetchMock.mockRestore();
  }
});
