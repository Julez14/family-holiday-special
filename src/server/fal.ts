import { z } from 'zod';
import type { AppEnv } from './env';
import { signingKey } from './env';
import { sign, sha256 } from './crypto';
import { AppError } from './errors';
import { boundedBody } from './media';
export interface ImageRequest {
  prompt: string;
  referenceUrls: string[];
  portrait: boolean;
}
export interface VideoRequest {
  prompt: string;
  frameUrl: string;
  referenceUrls: string[];
  seed: number;
}
export type MediaInput =
  { kind: 'image'; input: ImageRequest } | { kind: 'video'; input: VideoRequest };
export interface QueueProvider {
  submit(model: string, input: MediaInput, attemptId: string): Promise<string>;
  poll(
    model: string,
    requestId: string,
  ): Promise<{ state: 'pending' | 'completed' | 'failed'; payload?: unknown; category?: string }>;
}
export class SubmissionUnknown extends Error {}
export class ProviderRejected extends Error {
  constructor(public category: string) {
    super(category);
  }
}
const receiptSchema = z.object({ request_id: z.string().min(1).max(160) });
export function falInput(model: string, media: MediaInput): Record<string, unknown> {
  if (media.kind === 'image' && model === 'openai/gpt-image-2.6/flare/edit')
    return {
      prompt: media.input.prompt,
      image_urls: media.input.referenceUrls,
      num_images: 1,
      output_format: 'png',
      image_size: media.input.portrait
        ? { width: 768, height: 1024 }
        : { width: 1280, height: 720 },
      background: media.input.portrait ? 'transparent' : 'opaque',
      quality: 'high',
      enable_safety_checker: true,
    };
  if (media.kind === 'video' && model === 'minimax/h3-max/reference-to-video')
    return {
      prompt: media.input.prompt,
      image_url: media.input.frameUrl,
      reference_image_urls: media.input.referenceUrls,
      duration: 5,
      resolution: '768P',
      aspect_ratio: '16:9',
      seed: media.input.seed,
      prompt_expansion_mode: 'disabled',
      enable_safety_checker: true,
    };
  throw new Error(
    'Unsupported model contract: update the typed adapter and revalidate before substituting endpoints.',
  );
}
// REST submits exactly once. Never use an SDK's automatic non-idempotent retry loop.
export class FalQueue implements QueueProvider {
  constructor(private env: AppEnv) {}
  async submit(model: string, input: MediaInput, attemptId: string) {
    const callback = new URL('/api/fal/webhook', this.env.APP_ORIGIN);
    callback.searchParams.set('attempt', attemptId);
    callback.searchParams.set(
      'correlation',
      await sign(signingKey(this.env), `callback:${attemptId}`),
    );
    let response: Response;
    try {
      response = await fetch(
        `https://queue.fal.run/${model}?fal_webhook=${encodeURIComponent(callback.toString())}`,
        {
          method: 'POST',
          headers: { authorization: `Key ${this.env.FAL_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify(falInput(model, input)),
          signal: AbortSignal.timeout(20000),
        },
      );
    } catch {
      throw new SubmissionUnknown('Submission response was lost.');
    }
    if (response.status >= 400 && response.status < 500)
      throw new ProviderRejected(response.status === 422 ? 'safety' : 'provider_rejected');
    if (!response.ok) throw new SubmissionUnknown('Submission acceptance is unknown.');
    try {
      return receiptSchema.parse(
        JSON.parse(new TextDecoder().decode(await boundedBody(response, 64 * 1024))),
      ).request_id;
    } catch {
      throw new SubmissionUnknown('Submission receipt was unreadable.');
    }
  }
  async poll(model: string, requestId: string) {
    const base = `https://queue.fal.run/${model.split('/').slice(0, 2).join('/')}/requests/${encodeURIComponent(requestId)}`;
    const headers = { authorization: `Key ${this.env.FAL_KEY}` };
    const r = await fetch(`${base}/status`, { headers, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { state: 'pending' as const };
    const s = JSON.parse(new TextDecoder().decode(await boundedBody(r, 256 * 1024))) as {
      status: string;
    };
    if (s.status !== 'COMPLETED') return { state: 'pending' as const };
    const result = await fetch(base, { headers, signal: AbortSignal.timeout(15000) });
    if (!result.ok)
      return { state: 'failed' as const, category: result.status === 422 ? 'safety' : 'transient' };
    return {
      state: 'completed' as const,
      payload: JSON.parse(
        new TextDecoder().decode(await boundedBody(result, 2 * 1024 * 1024)),
      ) as unknown,
    };
  }
}
export function outputUrl(
  stage: 'image' | 'video',
  payload: unknown,
  allowedHosts: string[],
): string {
  const image = z.object({ images: z.array(z.object({ url: z.string().url() })).min(1) });
  const video = z.object({ video: z.object({ url: z.string().url() }) });
  const url =
    stage === 'image' ? image.parse(payload).images[0].url : video.parse(payload).video.url;
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !allowedHosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
  )
    throw new AppError(422, 'output', 'The generation service returned an unavailable file.');
  return url;
}
export async function verifyFalSignature(
  headers: Headers,
  body: Uint8Array,
  keys: JsonWebKey[],
  userId: string,
  now = Date.now(),
): Promise<boolean> {
  const request = headers.get('x-fal-webhook-request-id');
  const user = headers.get('x-fal-webhook-user-id');
  const time = headers.get('x-fal-webhook-timestamp');
  const signature = headers.get('x-fal-webhook-signature');
  if (
    !request ||
    request.length > 160 ||
    user !== userId ||
    !time ||
    !/^\d{10}$/.test(time) ||
    Math.abs(Number(time) - now / 1000) > 300 ||
    !signature ||
    !/^[0-9a-fA-F]{128}$/.test(signature)
  )
    return false;
  const message = new TextEncoder().encode([request, user, time, await sha256(body)].join('\n'));
  const sig = Uint8Array.from(signature.match(/../g)!, (x) => parseInt(x, 16));
  for (const jwk of keys)
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        { ...jwk, kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', ext: true },
        { name: 'Ed25519' },
        false,
        ['verify'],
      );
      if (await crypto.subtle.verify('Ed25519', key, sig, message)) return true;
    } catch {
      /* try the next rotating key */
    }
  return false;
}
export async function falKeys(): Promise<JsonWebKey[]> {
  const url = 'https://rest.fal.ai/.well-known/jwks.json';
  const cache = await caches.open('fal-jwks');
  const cached = await cache.match(url);
  let response = cached;
  if (!response) {
    response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Webhook keys unavailable.');
    const bytes = await boundedBody(response, 64 * 1024);
    response = new Response(bytes.slice().buffer, {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
    });
    await cache.put(url, response.clone());
  }
  return ((await response.json()) as { keys: JsonWebKey[] }).keys;
}
