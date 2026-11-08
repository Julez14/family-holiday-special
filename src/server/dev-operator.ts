import type { AppEnv } from './env';
import { verifyHmac } from './crypto';
import { localDevMessage } from '../shared/local-dev';

export function localBackendOnly(env: AppEnv): boolean {
  return (
    env.MODE === 'real' &&
    'RELEASE_CHANNEL' in env &&
    env.RELEASE_CHANNEL === 'dev' &&
    'LOCAL_DEV_ONLY' in env &&
    env.LOCAL_DEV_ONLY === 'true'
  );
}

// The loopback Vite server signs requests; this credential never reaches browser JS.
export async function authorizedLocalDevRequest(
  env: AppEnv,
  request: Request,
  now = Date.now(),
): Promise<boolean> {
  if (!localBackendOnly(env) || !env.DEV_OPERATOR_SECRET || env.DEV_OPERATOR_SECRET.length < 32)
    return false;
  const time = request.headers.get('X-Dev-Local-Time') ?? '';
  if (!/^\d{10}$/.test(time) || Math.abs(Number(time) - now / 1000) > 60) return false;
  const url = new URL(request.url);
  return verifyHmac(
    env.DEV_OPERATOR_SECRET,
    localDevMessage(request.method, url.pathname + url.search, time),
    request.headers.get('X-Dev-Local-Signature') ?? '',
  );
}

// An explicit dev operator credential allows repeatable, owned-project smoke tests.
// It never leaves the CLI, never applies to production, and follows the configured local usage policy.
export async function authorizedDevGeneration(
  env: AppEnv,
  projectId: string,
  idempotencyKey: string,
  headers: Headers,
  now = Date.now(),
): Promise<boolean> {
  if (
    !('RELEASE_CHANNEL' in env) ||
    env.RELEASE_CHANNEL !== 'dev' ||
    env.MODE !== 'real' ||
    !env.DEV_OPERATOR_SECRET ||
    env.DEV_OPERATOR_SECRET.length < 32
  )
    return false;
  const time = headers.get('X-Dev-Generation-Time') ?? '';
  const signature = headers.get('X-Dev-Generation-Signature') ?? '';
  if (!/^\d{10}$/.test(time) || Math.abs(Number(time) - now / 1000) > 60) return false;
  return verifyHmac(
    env.DEV_OPERATOR_SECRET,
    `dev-generate:${projectId}:${idempotencyKey}:${time}`,
    signature,
  );
}
