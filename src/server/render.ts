import type { AppEnv } from './env';
import type { Manifest } from '../shared/contracts';
import { storeOutput } from './output-storage';
import { mockFile, ArtifactFailure, inspect, asset } from './attempts';
export interface Renderer {
  render(
    projectId: string,
    manifest: Manifest,
    clips: string[],
    portraits: string[],
  ): Promise<{ videoId: string; posterId: string }>;
}
export class HolidayRenderer implements Renderer {
  constructor(private env: AppEnv) {}
  async render(projectId: string, manifest: Manifest, clips: string[], portraits: string[]) {
    if (this.env.MODE === 'mock') {
      const video = await mockFile(this.env, `${manifest.preset}-${manifest.cast.length}.mp4`);
      const poster = await mockFile(this.env, `${manifest.preset}-poster.jpg`);
      return {
        videoId: await storeOutput(
          this.env,
          projectId,
          'video',
          video,
          'video/mp4',
          60 * 1024 * 1024,
          { width: 1280, height: 720, duration: 20 },
        ),
        posterId: await storeOutput(
          this.env,
          projectId,
          'poster',
          poster,
          'image/jpeg',
          5 * 1024 * 1024,
          { width: 1280, height: 720 },
        ),
      };
    }
    if (!('RENDERER' in this.env)) throw new ArtifactFailure('render');
    const session = crypto.randomUUID();
    const renderer = this.env.RENDERER.getByName('media-1');
    const stage = async (name: string, object: R2ObjectBody) => {
      const response = await renderer.fetch(
        new Request(`http://renderer/stage/${session}/${name}`, {
          method: 'POST',
          body: object.body,
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(object.size),
          },
        }),
      );
      await response.body?.cancel();
      if (!response.ok) throw new ArtifactFailure('render');
    };
    const stageAsset = async (name: string, id: string) => {
      const media = await asset(this.env, id);
      if (media.project_id !== projectId) throw new ArtifactFailure('render');
      const object = await this.env.MEDIA.get(media.r2_key);
      if (!object) throw new ArtifactFailure('render');
      await stage(name, object);
    };
    try {
      for (const [i, id] of clips.entries()) await stageAsset(`clip-${i}.mp4`, id);
      for (const [i, id] of portraits.entries()) await stageAsset(`portrait-${i}.png`, id);
      if (manifest.musicKey !== `music/${manifest.preset}.wav`) throw new ArtifactFailure('render');
      const music = await this.env.MEDIA.get(manifest.musicKey);
      if (!music) throw new ArtifactFailure('render');
      await stage('music.wav', music);
      const body = JSON.stringify({
        version: 'ffmpeg-v1',
        inputMode: 'r2-stream-v1',
        session,
        portraitCount: portraits.length,
      });
      const headers = { 'content-type': 'application/json' };
      const r = await renderer.fetch(
        new Request('http://renderer/render', { method: 'POST', body, headers }),
      );
      if (!r.ok) throw new ArtifactFailure('render');
      const videoId = await storeOutput(
        this.env,
        projectId,
        'video',
        r,
        'video/mp4',
        60 * 1024 * 1024,
        { width: 1280, height: 720, duration: 20 },
      );
      const checked = await inspect(this.env, projectId, videoId, true);
      if (
        checked.width !== 1280 ||
        checked.height !== 720 ||
        Math.abs((checked.duration ?? 0) - 20) > 0.12
      )
        throw new ArtifactFailure('render');
      const p = await renderer.fetch(
        new Request('http://renderer/poster', { method: 'POST', body, headers }),
      );
      if (!p.ok) throw new ArtifactFailure('render');
      const posterId = await storeOutput(
        this.env,
        projectId,
        'poster',
        p,
        'image/png',
        5 * 1024 * 1024,
        { width: 1280, height: 720 },
      );
      return { videoId, posterId };
    } finally {
      try {
        const cleanup = await renderer.fetch(
          new Request(`http://renderer/stage/${session}`, { method: 'DELETE' }),
        );
        await cleanup.body?.cancel();
      } catch {
        /* Ephemeral staging is also removed when the idle container stops. */
      }
    }
  }
}
