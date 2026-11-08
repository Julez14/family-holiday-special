export type AppEnv = (Env | RealEnv | DevEnv) & {
  FAL_KEY?: string;
  ASSET_SIGNING_SECRET?: string;
  TURNSTILE_SECRET?: string;
  DEV_OPERATOR_SECRET?: string;
};
export function unlimitedLocalDev(env: AppEnv): boolean {
  return (
    env.MODE === 'real' &&
    'RELEASE_CHANNEL' in env &&
    env.RELEASE_CHANNEL === 'dev' &&
    'LOCAL_DEV_ONLY' in env &&
    env.LOCAL_DEV_ONLY === 'true' &&
    'DEV_UNLIMITED_USAGE' in env &&
    env.DEV_UNLIMITED_USAGE === 'true' &&
    !!env.DEV_OPERATOR_SECRET &&
    env.DEV_OPERATOR_SECRET.length >= 32
  );
}
export function illustrativePreviews(env: AppEnv): boolean {
  return (
    env.MODE === 'mock' ||
    ('RELEASE_CHANNEL' in env &&
      env.RELEASE_CHANNEL === 'dev' &&
      env.PREVIEW_MODE === 'illustrative')
  );
}
export function signingKey(env: AppEnv): string {
  if (env.ASSET_SIGNING_SECRET && env.ASSET_SIGNING_SECRET.length >= 32)
    return env.ASSET_SIGNING_SECRET;
  if (env.MODE === 'mock' && new URL(env.APP_ORIGIN).hostname === 'localhost')
    return 'local-mock-only-signing-key-never-use-in-real-mode';
  throw new Error('Signing secret is required.');
}
