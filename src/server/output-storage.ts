import type { AppEnv } from './env';
import type { AssetKind } from '../shared/contracts';
import { saveAsset } from './db';
import { boundedBody } from './media';
import { AppError } from './errors';

// Stream known-size CDN/container output into R2. A full MP4 must not be copied
// into two large buffers in a 128 MiB Worker isolate. FixedLengthStream also
// rejects a truncated or dishonest Content-Length rather than publishing it.
export async function storeOutput(
  env: AppEnv,
  projectId: string,
  kind: AssetKind,
  response: Response,
  mime: string,
  maxBytes: number,
  meta: { width?: number; height?: number; duration?: number } = {},
): Promise<string> {
  const raw = response.headers.get('content-length');
  const length = raw ? Number(raw) : NaN;
  if (!response.body || !response.ok)
    throw new AppError(422, 'output', 'The media file is unavailable.');
  if (!Number.isSafeInteger(length) || length < 1) {
    // Unknown-size output is accepted only within a small, strictly bounded fallback.
    return saveAsset(
      env,
      projectId,
      kind,
      await boundedBody(response, Math.min(maxBytes, 8 * 1024 * 1024)),
      mime,
      meta,
    );
  }
  if (length > maxBytes)
    throw new AppError(413, 'output', 'The generated media file is too large.');
  const fixed = new FixedLengthStream(length);
  const controller = new AbortController();
  const transfer = response.body.pipeTo(fixed.writable, { signal: controller.signal });
  const write = saveAsset(env, projectId, kind, fixed.readable, mime, meta).catch((error) => {
    controller.abort();
    throw error;
  });
  const results = await Promise.allSettled([transfer, write]);
  if (results[0].status === 'rejected') throw results[0].reason;
  if (results[1].status === 'rejected') throw results[1].reason;
  return results[1].value;
}
