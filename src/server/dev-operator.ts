import type { AppEnv } from './env';
import { verifyHmac } from './crypto';

// An explicit dev operator credential allows repeatable, owned-project smoke tests.
// It never leaves the CLI, never applies to production, and does not skip budgets.
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
