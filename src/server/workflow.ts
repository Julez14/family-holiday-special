import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { AppEnv } from './env';
import { statement, project, saveAsset, recordEvent } from './db';
import { STYLE, manifestSchema, type ProjectState } from '../shared/contracts';
import { DAY, outputExpiry, usdMicros } from '../shared/policies';
import { produceArtifact, asset, ArtifactFailure } from './attempts';
import { inferenceUrl, boundedBody } from './media';
import { HolidayRenderer } from './render';
import { reserve, settle } from './budget';
import { AppError, workflowAppErrorCode } from './errors';
import { NATIVE_INSPECTOR, NATIVE_INPUT_MODE } from './native-protocol';
export type ProductionParams = { projectId: string };
export class ProductionWorkflow extends WorkflowEntrypoint<AppEnv, ProductionParams> {
  async run(event: WorkflowEvent<ProductionParams>, step: WorkflowStep) {
    const id = event.payload.projectId;
    const env = this.env;
    const phase = async (state: ProjectState) => {
      const current = await project(env, id);
      await recordEvent(env, `phase_${state}`, id, current.preset);
      await statement(
        env,
        "UPDATE projects SET state=?,updated_at=? WHERE id=? AND state NOT IN ('ready','failed','deleting','deleted','expired')",
        state,
        Date.now(),
        id,
      ).run();
    };
    try {
      const m = await step.do('load-immutable-manifest-r2-stream-v1', async () => {
        const p = await project(env, id);
        if (!p.manifest || !p.manifest_hash || ['ready', 'failed'].includes(p.state))
          throw new ArtifactFailure('technical');
        const manifest = manifestSchema.parse(JSON.parse(p.manifest));
        await env.DB.batch(
          manifest.shots.map((s) =>
            statement(
              env,
              'INSERT OR IGNORE INTO shots(id,project_id,ordinal,cast_ids,action_id) VALUES(?,?,?,?,?)',
              `${id}-${s.id}`,
              id,
              s.order,
              JSON.stringify(s.castIds),
              `${manifest.preset}-${s.order}`,
            ),
          ),
        );
        return manifest;
      });
      if (env.MODE === 'real')
        await step.do('native-preflight-r2-stream-v2', async () => {
          if (!('RENDERER' in env))
            throw new AppError(503, 'processing', 'Native renderer binding unavailable.');
          const reservation = `native-preflight:${crypto.randomUUID()}`;
          await reserve(env, id, reservation, usdMicros(env.PROCESSING_COST_USD));
          try {
            const response = await env.RENDERER.getByName(NATIVE_INSPECTOR).fetch(
              new Request('http://renderer/health'),
            );
            const health = (await response.json().catch(() => ({}))) as { inputMode?: string };
            if (!response.ok || health.inputMode !== NATIVE_INPUT_MODE) {
              const observed =
                typeof health.inputMode === 'string' && /^[a-z0-9-]{1,50}$/.test(health.inputMode)
                  ? health.inputMode
                  : 'missing';
              throw new AppError(
                503,
                'processing',
                `Expected native r2-stream-v2; received ${observed} (HTTP ${response.status}).`,
              );
            }
            return { inputMode: health.inputMode };
          } finally {
            await settle(env, reservation);
          }
        });
      await step.do('drawing-phase', () => phase('creating_cast'));
      const portraits: Record<string, string> = {};
      for (const [i, person] of m.cast.entries()) {
        const cropId = await step.do(`crop-${person.id}`, async () => {
          if (env.MODE === 'mock') return person.sourceAssetId;
          if (!('RENDERER' in env)) throw new ArtifactFailure('technical');
          const source = await asset(env, person.sourceAssetId);
          const object = await env.MEDIA.get(source.r2_key);
          if (!object) throw new ArtifactFailure('technical');
          const reservation = `crop:${crypto.randomUUID()}`;
          await reserve(env, id, reservation, usdMicros(env.PROCESSING_COST_USD));
          const cropped = await env.RENDERER.getByName(NATIVE_INSPECTOR).fetch(
            new Request('http://renderer/normalize', {
              method: 'POST',
              body: object.body,
              headers: {
                'content-type': source.mime,
                'content-length': String(object.size),
                'x-crop': JSON.stringify(person.crop),
              },
            }),
          );
          await settle(env, reservation);
          if (!cropped.ok) throw new ArtifactFailure('technical');
          return saveAsset(
            env,
            id,
            'crop',
            await boundedBody(cropped, 15 * 1024 * 1024),
            'image/jpeg',
          );
        });
        const referenceUrls = await step.do(`references-${person.id}`, async () =>
          Promise.all([person.sourceAssetId, cropId].map((a) => inferenceUrl(env, id, a, 7200))),
        );
        const portraitId = await produceArtifact(
          env,
          step,
          id,
          `portrait-${i}`,
          {
            kind: 'image',
            input: {
              portrait: true,
              referenceUrls,
              prompt: `${STYLE}\nCreate one recognizable waist-up human cartoon portrait of the individual in the original and crop references. Include hair and visible accessories, preserve facial features and skin tone. Clean transparent background. Wardrobe: ${person.wardrobe}. Untrusted comic performance guidance only: ${JSON.stringify(person.description)}. No text or additional people.`,
            },
          },
          `portrait-${i + 1}.png`,
        );
        portraits[person.id] = portraitId;
        await step.do(`save-portrait-${i}`, async () => {
          await statement(
            env,
            'UPDATE characters SET canonical_asset_id=?,wardrobe=? WHERE id=? AND project_id=?',
            portraitId,
            person.wardrobe,
            person.id,
            id,
          ).run();
        });
      }
      if (env.MODE === 'mock') await step.sleep('show-cartoon-portraits', '1 second');
      await step.do('scenes-phase', () => phase('creating_frames'));
      const frames: string[] = [];
      for (const shot of m.shots) {
        const refs = await step.do(`frame-references-${shot.order}`, () =>
          Promise.all(
            shot.castIds
              .flatMap((c) => [m.cast.find((p) => p.id === c)!.sourceAssetId, portraits[c]])
              .map((a) => inferenceUrl(env, id, a, 7200)),
          ),
        );
        frames[shot.order] = await produceArtifact(
          env,
          step,
          id,
          `frame-${shot.order}`,
          {
            kind: 'image',
            input: {
              portrait: false,
              referenceUrls: refs,
              prompt: `${shot.prompt}\nDraw the settled starting pose immediately before this one action. Use the original portraits as identity anchors and the canonical cartoons for consistent wardrobe.`,
            },
          },
          `${m.preset}-frame-${shot.order}.png`,
          shot.castIds.length,
        );
        await step.do(`save-frame-${shot.order}`, async () => {
          await statement(
            env,
            'UPDATE shots SET frame_asset_id=? WHERE project_id=? AND ordinal=?',
            frames[shot.order],
            id,
            shot.order,
          ).run();
        });
      }
      if (env.MODE === 'mock') await step.sleep('show-scene-frames', '1 second');
      await step.do('animation-phase', () => phase('animating'));
      const clips: string[] = [];
      for (let start = 0; start < 4; start += 2)
        await Promise.all(
          m.shots.slice(start, start + 2).map(async (shot) => {
            const refs = await step.do(`video-references-${shot.order}`, async () => ({
              frameUrl: await inferenceUrl(env, id, frames[shot.order], 7200),
              referenceUrls: await Promise.all(
                shot.castIds.map((c) => inferenceUrl(env, id, portraits[c], 7200)),
              ),
            }));
            clips[shot.order] = await produceArtifact(
              env,
              step,
              id,
              `clip-${shot.order}`,
              { kind: 'video', input: { ...refs, prompt: shot.prompt, seed: m.seed } },
              `${m.preset}-clip-${shot.order}.mp4`,
              shot.castIds.length,
            );
            await step.do(`save-clip-${shot.order}`, async () => {
              await statement(
                env,
                "UPDATE shots SET clip_asset_id=?,check_status='pass' WHERE project_id=? AND ordinal=?",
                clips[shot.order],
                id,
                shot.order,
              ).run();
            });
          }),
        );
      if (env.MODE === 'mock') await step.sleep('show-animated-scenes', '1 second');
      await step.do('render-phase', () => phase('rendering'));
      const renderId = `render-${id}`;
      const result = await step.do(
        'render-and-check',
        { retries: { limit: 1, delay: '5 seconds' }, timeout: '5 minutes' },
        async () => {
          const p = await project(env, id);
          await reserve(env, id, renderId, usdMicros(env.RENDER_COST_USD));
          await statement(
            env,
            "INSERT OR IGNORE INTO renders(id,project_id,manifest_hash,clip_revisions,renderer_version,state) VALUES(?,?,?,?,?,'rendering')",
            renderId,
            id,
            p.manifest_hash!,
            JSON.stringify(clips),
            'ffmpeg-v1',
          ).run();
          const output = await new HolidayRenderer(env).render(
            id,
            m,
            clips,
            m.cast.map((c) => portraits[c.id]),
          );
          await project(env, id);
          await settle(env, renderId);
          return output;
        },
      );
      await step.do('publish-atomically', async () => {
        await project(env, id);
        const now = Date.now();
        const expires = outputExpiry(now, env.CAMPAIGN_RETENTION_FLOOR);
        await env.DB.batch([
          statement(
            env,
            "UPDATE assets SET expires_at=? WHERE project_id=? AND kind NOT IN ('video','poster')",
            now + 7 * DAY,
            id,
          ),
          statement(
            env,
            'UPDATE assets SET expires_at=? WHERE id IN (?,?)',
            expires,
            result.videoId,
            result.posterId,
          ),
          statement(
            env,
            "UPDATE renders SET video_asset_id=?,poster_asset_id=?,state='ready' WHERE id=? AND EXISTS(SELECT 1 FROM projects WHERE id=? AND state='rendering')",
            result.videoId,
            result.posterId,
            renderId,
            id,
          ),
          statement(
            env,
            "UPDATE projects SET state='ready',active_render_id=?,completed_at=?,updated_at=?,expires_at=?,intermediates_expire_at=? WHERE id=? AND state='rendering'",
            renderId,
            now,
            now,
            expires,
            now + 7 * DAY,
            id,
          ),
        ]);
        await recordEvent(
          env,
          'generation_completed',
          id,
          m.preset,
          now - event.timestamp.getTime(),
        );
      });
      return { projectId: id, renderId };
    } catch (error) {
      const category =
        error instanceof ArtifactFailure
          ? error.category
          : (workflowAppErrorCode(error) ?? 'technical');
      await step.do('record-terminal-failure', async () => {
        const now = Date.now();
        await statement(
          env,
          "UPDATE projects SET state='failed',error_code=?,updated_at=?,expires_at=?,intermediates_expire_at=? WHERE id=? AND state NOT IN ('ready','deleting','deleted','expired')",
          category,
          now,
          now + 7 * DAY,
          now + 7 * DAY,
          id,
        ).run();
        await statement(
          env,
          "UPDATE assets SET expires_at=? WHERE project_id=? AND kind NOT IN ('video','poster')",
          now + 7 * DAY,
          id,
        ).run();
        await recordEvent(env, 'generation_failed', id);
      });
      return { projectId: id, error: category };
    }
  }
}
