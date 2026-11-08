export type AppEnv = (Env | RealEnv) & {
  FAL_KEY?: string;
  ASSET_SIGNING_SECRET?: string;
  TURNSTILE_SECRET?: string;
};
export function signingKey(env: AppEnv): string {
  if (env.ASSET_SIGNING_SECRET) return env.ASSET_SIGNING_SECRET;
  if (env.MODE === 'mock' && new URL(env.APP_ORIGIN).hostname === 'localhost')
    return 'local-mock-only-signing-key-never-use-in-real-mode';
  throw new Error('Signing secret is required.');
}
