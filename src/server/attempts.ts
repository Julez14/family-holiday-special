import type { WorkflowStep } from 'cloudflare:workers';
import type { AppEnv } from './env';
import { statement, project, type AttemptRow, type AssetRow } from './db';
import { FalQueue, SubmissionUnknown, ProviderRejected, outputUrl, type MediaInput } from './fal';
import { reserve, settle, realReady } from './budget';
import { inferenceUrl } from './media';
import { usdMicros, RETRY_CAPS, canRepair } from '../shared/policies';
import { sha256 } from './crypto';
import { PROMPT_VERSION, reviewSchema } from '../shared/contracts';
import { recordCallback } from './webhook';
import { storeOutput } from './output-storage';
import { AppError } from './errors';
export class ArtifactFailure extends Error {
  constructor(public category: string) {
    super(category);
  }
}
export async function mockFile(env: AppEnv, path: string) {
  const r = await env.ASSETS.fetch(new Request(`https://fixtures.invalid/fixtures/${path}`));
  if (!r.ok || r.headers.get('content-type')?.includes('text/html'))
    throw new ArtifactFailure('technical');
  return r;
}
export async function prepareAttempt(
  env: AppEnv,
  projectId: string,
  artifact: string,
  revision: number,
  input: MediaInput,
): Promise<AttemptRow> {
  const stage = input.kind;
  const now = Date.now();
  const cap = RETRY_CAPS[stage];
  const model = stage === 'image' ? env.IMAGE_MODEL : env.VIDEO_MODEL;
  const price = usdMicros(stage === 'image' ? env.IMAGE_COST_USD : env.VIDEO_COST_USD);
  await statement(
    env,
    `INSERT OR IGNORE INTO attempts(id,project_id,artifact,revision,stage,provider,model,prompt_hash,prompt_version,estimate_micros,created_at,updated_at)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (?=0 OR (SELECT COUNT(*) FROM attempts WHERE project_id=? AND stage=? AND revision>0)<?)
 AND EXISTS(SELECT 1 FROM projects WHERE id=? AND state NOT IN ('deleting','deleted','expired','failed','ready'))`,
    crypto.randomUUID(),
    projectId,
    artifact,
    revision,
    stage,
    env.MODE === 'mock' ? 'mock' : 'fal',
    model,
    await sha256(JSON.stringify(input)),
    PROMPT_VERSION,
    price,
    now,
    now,
    revision,
    projectId,
    stage,
    cap,
    projectId,
  ).run();
  const row = await statement(
    env,
    'SELECT * FROM attempts WHERE project_id=? AND artifact=? AND revision=?',
    projectId,
    artifact,
    revision,
  ).first<AttemptRow>();
  if (!row) throw new ArtifactFailure('technical');
  await reserve(env, projectId, row.id, row.estimate_micros);
  return row;
}
export async function claimSubmission(env: AppEnv, attempt: AttemptRow): Promise<boolean> {
  return !!(
    await statement(
      env,
      `UPDATE attempts SET state='submitting',updated_at=? WHERE id=? AND state='prepared'
 AND (SELECT COUNT(*) FROM attempts WHERE state IN ('submitting','queued','in_progress','submission_unknown')) < ?
 AND EXISTS(SELECT 1 FROM projects WHERE id=? AND state NOT IN ('deleting','deleted','expired','failed','ready'))`,
      Date.now(),
      attempt.id,
      Number(env.MAX_PROVIDER_CONCURRENCY),
      attempt.project_id,
    ).run()
  ).meta.changes;
}
export async function submitOnce(env: AppEnv, attemptId: string, media: MediaInput) {
  const a = await statement(
    env,
    'SELECT * FROM attempts WHERE id=?',
    attemptId,
  ).first<AttemptRow>();
  if (!a) throw new ArtifactFailure('technical');
  if (a.state !== 'submitting') return;
  // This function is invoked only by a no-retry Workflow step after an atomic claim.
  try {
    realReady(env);
  } catch (error) {
    await statement(
      env,
      "UPDATE attempts SET state='failed',error_category='unavailable',updated_at=? WHERE id=? AND request_id IS NULL",
      Date.now(),
      a.id,
    ).run();
    await settle(env, a.id, true);
    throw error;
  }
  await statement(
    env,
    'UPDATE attempts SET submitted_at=COALESCE(submitted_at,?) WHERE id=?',
    Date.now(),
    a.id,
  ).run();
  try {
    const requestId =
      env.MODE === 'mock'
        ? `mock-${crypto.randomUUID()}`
        : await new FalQueue(env).submit(a.model, media, a.id);
    if (env.MODE === 'mock' && env.MOCK_SCENARIO === 'submission-unknown')
      throw new SubmissionUnknown('fixture');
    if (env.MODE === 'mock' && env.MOCK_SCENARIO === 'callback-before-save')
      await recordCallback(env, a.id, {
        request_id: requestId,
        status: 'OK',
        payload: { fixture: true },
      });
    await statement(
      env,
      "UPDATE attempts SET request_id=?,state='queued',updated_at=? WHERE id=? AND (request_id IS NULL OR request_id=?) AND state IN ('submitting','queued')",
      requestId,
      Date.now(),
      a.id,
      requestId,
    ).run();
  } catch (e) {
    if (e instanceof ProviderRejected) {
      await statement(
        env,
        "UPDATE attempts SET state='failed',error_category=?,updated_at=? WHERE id=?",
        e.category,
        Date.now(),
        a.id,
      ).run();
      await settle(env, a.id, true);
    } else {
      await statement(
        env,
        "UPDATE attempts SET state='submission_unknown',error_category='submission_unknown',updated_at=? WHERE id=? AND request_id IS NULL",
        Date.now(),
        a.id,
      ).run();
    }
  }
}
export interface Inspection {
  width: number;
  height: number;
  duration?: number;
  samples?: string[];
}
export async function inspect(
  env: AppEnv,
  projectId: string,
  assetId: string,
  video: boolean,
): Promise<Inspection> {
  if (!('RENDERER' in env)) throw new ArtifactFailure('technical');
  const reservation = `inspect:${crypto.randomUUID()}`;
  await reserve(env, projectId, reservation, usdMicros(env.PROCESSING_COST_USD));
  const r = await env.RENDERER.getByName('media-0').fetch(
    new Request('http://renderer/inspect', {
      method: 'POST',
      body: JSON.stringify({ url: await inferenceUrl(env, projectId, assetId), video }),
      headers: { 'content-type': 'application/json' },
    }),
  );
  await settle(env, reservation);
  if (!r.ok) throw new ArtifactFailure('technical');
  const result = (await r.json()) as Inspection;
  if (
    !result.width ||
    !result.height ||
    (video &&
      (!result.duration ||
        result.duration < 4.5 ||
        Math.abs(result.width / result.height - 16 / 9) > 0.05 ||
        !result.samples?.length))
  )
    throw new ArtifactFailure('technical');
  return result;
}
async function advisoryReview(
  env: AppEnv,
  attempt: AttemptRow,
  inspection: Inspection,
  expectedPeople: number,
) {
  if (!('AI' in env) || env.REVIEW_ENABLED !== 'true' || !inspection.samples?.length)
    return 'uncertain';
  const claim = await statement(
    env,
    'UPDATE attempts SET review_calls=review_calls+1 WHERE id=? AND review_calls<2 RETURNING review_calls',
    attempt.id,
  ).first<{ review_calls: number }>();
  if (!claim) return 'uncertain';
  const reservation = `review:${attempt.id}:${claim.review_calls}`;
  await reserve(env, attempt.project_id, reservation, usdMicros(env.REVIEW_COST_USD));
  try {
    const raw = await env.AI.run(env.TEXT_MODEL as Parameters<Ai['run']>[0], {
      messages: [
        {
          role: 'system',
          content:
            'Review only obvious composition failures in an intentional exaggerated hand-drawn 2D cartoon. Never score identity. Squash and stretch is intentional. Return JSON {"verdict":"pass|clear_failure|uncertain","reason":"short"}. Use clear_failure only for unmistakably missing/extra people, severe face occlusion or a 3D style. Otherwise pass or uncertain.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Expected visible people: ${expectedPeople}.` },
            ...inspection.samples
              .slice(0, 3)
              .map((url) => ({ type: 'image_url', image_url: { url } })),
          ],
        },
      ],
      max_completion_tokens: 128,
      chat_template_kwargs: { enable_thinking: false },
      skip_special_tokens: true,
      response_format: { type: 'json_object' },
    });
    const o = raw as { response?: string; choices?: { message?: { content?: string } }[] };
    return reviewSchema.parse(JSON.parse(o.response ?? o.choices?.[0]?.message?.content ?? '{}'))
      .verdict;
  } catch {
    return 'uncertain';
  } finally {
    await settle(env, reservation);
  }
}
export async function produceArtifact(
  env: AppEnv,
  step: WorkflowStep,
  projectId: string,
  artifact: string,
  media: MediaInput,
  fixture: string,
  expectedPeople = 1,
): Promise<string> {
  for (let revision = 0; revision <= RETRY_CAPS[media.kind]; revision++) {
    const tag = `${artifact}-v${revision}`;
    const a = await step.do(`${tag}-prepare`, () =>
      prepareAttempt(env, projectId, artifact, revision, media),
    );
    if (a.state === 'accepted' && a.output_asset_id) return a.output_asset_id;
    let claimed = false;
    let slotReady = false;
    for (let slot = 0; slot < 100; slot++) {
      const state = await step.do(`${tag}-claim-${slot}`, async () => {
        await project(env, projectId);
        const row = await statement(env, 'SELECT state FROM attempts WHERE id=?', a.id).first<{
          state: string;
        }>();
        if (row?.state !== 'prepared') return 'already_started';
        return (await claimSubmission(env, a)) ? 'claimed' : 'busy';
      });
      if (state !== 'busy') {
        claimed = state === 'claimed';
        slotReady = true;
        break;
      }
      await step.sleep(`${tag}-slot-${slot}`, '5 seconds');
    }
    if (!slotReady) {
      await step.do(`${tag}-capacity-timeout`, async () => {
        await statement(
          env,
          "UPDATE attempts SET state='failed',error_category='timeout',updated_at=? WHERE id=? AND state='prepared'",
          Date.now(),
          a.id,
        ).run();
        await settle(env, a.id, true);
      });
      throw new ArtifactFailure('timeout');
    }
    if (claimed)
      await step.do(
        `${tag}-submit`,
        { retries: { limit: 0, delay: '1 second' }, timeout: '30 seconds' },
        () => submitOnce(env, a.id, media),
      );
    let payload: unknown;
    let category: string | null = null;
    const maxPolls = env.MODE === 'mock' ? 3 : 80;
    for (let tick = 0; tick < maxPolls; tick++) {
      const result = await step.do(
        `${tag}-poll-${tick}`,
        async (): Promise<{
          state: string;
          assetId?: string | null;
          category?: string;
          payloadJson?: string;
        }> => {
          await project(env, projectId);
          const row = await statement(
            env,
            'SELECT * FROM attempts WHERE id=?',
            a.id,
          ).first<AttemptRow>();
          if (row?.state === 'accepted') return { state: 'accepted', assetId: row.output_asset_id };
          if (row?.state === 'failed')
            return { state: 'failed', category: row.error_category ?? 'technical' };
          if (!row?.request_id) return { state: 'pending', category: 'submission_unknown' };
          if (env.MODE === 'mock') {
            if (env.MOCK_SCENARIO === 'rejection') return { state: 'failed', category: 'safety' };
            if (env.MOCK_SCENARIO === 'failed-scene' && artifact === 'clip-1' && revision === 0)
              return { state: 'failed', category: 'transient' };
            if (env.MOCK_SCENARIO === 'exhausted-retries' && artifact.startsWith('clip-'))
              return { state: 'failed', category: 'technical' };
            return { state: 'completed', payloadJson: '{"fixture":true}' };
          }
          const inbox = await statement(
            env,
            'SELECT status,payload FROM webhook_inbox WHERE request_id=? AND attempt_id=?',
            row.request_id,
            a.id,
          ).first<{ status: string; payload: string }>();
          if (inbox?.status === 'OK' && inbox.payload !== 'null')
            return { state: 'completed', payloadJson: inbox.payload };
          if (inbox?.status === 'ERROR') return { state: 'failed', category: 'provider_rejected' };
          // A missing callback queries the known request. It never submits replacement work.
          try {
            const polled = await new FalQueue(env).poll(row.model, row.request_id);
            await statement(
              env,
              'UPDATE attempts SET started_at=CASE WHEN ?=1 THEN COALESCE(started_at,?) ELSE started_at END,completed_at=CASE WHEN ?=1 THEN COALESCE(completed_at,?) ELSE completed_at END,provider_inference_ms=COALESCE(?,provider_inference_ms) WHERE id=?',
              polled.providerState === 'IN_PROGRESS' ? 1 : 0,
              Date.now(),
              polled.state === 'completed' ? 1 : 0,
              Date.now(),
              polled.inferenceMs ?? null,
              a.id,
            ).run();
            return {
              state: polled.state,
              category: polled.category,
              payloadJson: polled.payload ? JSON.stringify(polled.payload) : undefined,
            };
          } catch {
            return { state: 'pending' };
          }
        },
      );
      if (result.state === 'accepted' && 'assetId' in result && result.assetId)
        return result.assetId;
      if (result.state === 'failed') {
        category = result.category ?? 'technical';
        break;
      }
      if (result.state === 'completed' && result.payloadJson) {
        payload = JSON.parse(result.payloadJson);
        break;
      }
      if (tick === maxPolls - 1)
        category =
          'category' in result && result.category === 'submission_unknown'
            ? 'submission_unknown'
            : 'timeout';
      else await step.sleep(`${tag}-wait-${tick}`, env.MODE === 'mock' ? '1 second' : '10 seconds');
    }
    if (payload) {
      const checked = await step.do(
        `${tag}-check-copy`,
        { retries: { limit: 2, delay: '2 seconds' }, timeout: '3 minutes' },
        async () => {
          await project(env, projectId);
          let response: Response;
          if (env.MODE === 'mock') response = await mockFile(env, fixture);
          else
            response = await fetch(
              outputUrl(
                media.kind,
                payload,
                ('PROVIDER_OUTPUT_HOSTS' in env ? env.PROVIDER_OUTPUT_HOSTS : 'fal.media')
                  .split(',')
                  .map((s) => s.trim()),
              ),
              { redirect: 'error', signal: AbortSignal.timeout(30000) },
            );
          if (!response.ok) return { category: 'technical' };
          const mime = media.kind === 'video' ? 'video/mp4' : 'image/png';
          const assetId = await storeOutput(
            env,
            projectId,
            media.kind === 'video' ? 'clip' : media.input.portrait ? 'portrait' : 'frame',
            response,
            mime,
            media.kind === 'video' ? 60 * 1024 * 1024 : 15 * 1024 * 1024,
          );
          if (env.MODE === 'real') {
            try {
              const inspection = await inspect(env, projectId, assetId, media.kind === 'video');
              if (
                (!('portrait' in media.input) || !media.input.portrait) &&
                (await advisoryReview(env, a, inspection, expectedPeople)) === 'clear_failure'
              )
                return { category: 'technical' };
              await statement(
                env,
                'UPDATE assets SET width=?,height=?,duration=? WHERE id=?',
                inspection.width,
                inspection.height,
                inspection.duration ?? null,
                assetId,
              ).run();
            } catch (e) {
              if (e instanceof AppError && e.code === 'budget') throw e;
              return { category: 'technical' };
            }
          }
          await project(env, projectId);
          await statement(
            env,
            "UPDATE attempts SET state='accepted',output_asset_id=?,updated_at=?,completed_at=COALESCE(completed_at,?) WHERE id=?",
            assetId,
            Date.now(),
            Date.now(),
            a.id,
          ).run();
          await settle(env, a.id);
          return { assetId };
        },
      );
      if ('assetId' in checked && checked.assetId) return checked.assetId;
      category = checked.category ?? 'technical';
    }
    await step.do(`${tag}-record-failure`, async () => {
      await statement(
        env,
        "UPDATE attempts SET state=CASE WHEN ?='submission_unknown' THEN 'submission_unknown' ELSE 'failed' END,error_category=?,updated_at=? WHERE id=? AND state!='accepted'",
        category ?? 'technical',
        category ?? 'technical',
        Date.now(),
        a.id,
      ).run();
      if (category !== 'submission_unknown') await settle(env, a.id);
    });
    const used = await step.do(
      `${tag}-repair-count`,
      async () =>
        (await statement(
          env,
          'SELECT COUNT(*) AS n FROM attempts WHERE project_id=? AND stage=? AND revision>0',
          projectId,
          media.kind,
        ).first<{ n: number }>())!.n,
    );
    if (!canRepair(media.kind, used, category ?? 'technical'))
      throw new ArtifactFailure(category ?? 'technical');
    await step.do(`${tag}-recovery-event`, async () => {
      await statement(
        env,
        'INSERT INTO events(name,project_id,value,created_at) VALUES(?,?,?,?)',
        'automatic_scene_recovery',
        projectId,
        revision + 1,
        Date.now(),
      ).run();
    });
    // Only simplify the failed artifact; never alter accepted references or the manifest.
    const prompt =
      media.input.prompt +
      '\nSimplify the action: one slow, readable gesture, no occlusion, faces fully visible.';
    media =
      media.kind === 'image'
        ? { kind: 'image', input: { ...media.input, prompt } }
        : { kind: 'video', input: { ...media.input, prompt } };
  }
  throw new ArtifactFailure('technical');
}
export async function asset(env: AppEnv, id: string) {
  const a = await statement(env, 'SELECT * FROM assets WHERE id=?', id).first<AssetRow>();
  if (!a) throw new ArtifactFailure('technical');
  return a;
}
