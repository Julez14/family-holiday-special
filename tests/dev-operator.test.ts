import { expect, it } from 'vitest';
import type { AppEnv } from '../src/server/env';
import { authorizedDevGeneration } from '../src/server/dev-operator';
import { illustrativePreviews } from '../src/server/env';
import { sign } from '../src/server/crypto';

it('scopes dev operator authorization to the project, idempotency key, channel and minute', async () => {
  const env = {
    MODE: 'real',
    RELEASE_CHANNEL: 'dev',
    DEV_OPERATOR_SECRET: 'x'.repeat(64),
  } as AppEnv;
  const now = 1794100000000;
  const time = String(Math.floor(now / 1000));
  const headers = new Headers({
    'X-Dev-Generation-Time': time,
    'X-Dev-Generation-Signature': await sign(
      env.DEV_OPERATOR_SECRET!,
      `dev-generate:p1:key1:${time}`,
    ),
  });
  expect(await authorizedDevGeneration(env, 'p1', 'key1', headers, now)).toBe(true);
  expect(await authorizedDevGeneration(env, 'p2', 'key1', headers, now)).toBe(false);
  expect(await authorizedDevGeneration(env, 'p1', 'key2', headers, now)).toBe(false);
  expect(await authorizedDevGeneration(env, 'p1', 'key1', headers, now + 61000)).toBe(false);
  expect(
    await authorizedDevGeneration(
      { ...env, RELEASE_CHANNEL: 'main' } as AppEnv,
      'p1',
      'key1',
      headers,
      now,
    ),
  ).toBe(false);
  expect(
    await authorizedDevGeneration({ ...env, MODE: 'mock' } as AppEnv, 'p1', 'key1', headers, now),
  ).toBe(false);
  expect(
    await authorizedDevGeneration(
      { ...env, DEV_OPERATOR_SECRET: undefined },
      'p1',
      'key1',
      headers,
      now,
    ),
  ).toBe(false);
});

it('allows illustrative previews in paid dev without relaxing production launch assets', () => {
  expect(
    illustrativePreviews({
      MODE: 'real',
      RELEASE_CHANNEL: 'dev',
      PREVIEW_MODE: 'illustrative',
    } as AppEnv),
  ).toBe(true);
  expect(
    illustrativePreviews({
      MODE: 'real',
      RELEASE_CHANNEL: 'main',
      PREVIEW_MODE: 'illustrative',
    } as AppEnv),
  ).toBe(false);
  expect(illustrativePreviews({ MODE: 'real' } as AppEnv)).toBe(false);
  expect(illustrativePreviews({ MODE: 'mock' } as AppEnv)).toBe(true);
});
