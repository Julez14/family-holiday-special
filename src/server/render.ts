import type { AppEnv } from './env';
import type { Manifest } from '../shared/contracts';
import { storeOutput } from './output-storage';
import { inferenceUrl } from './media';
import { mockFile, ArtifactFailure, inspect } from './attempts';
import { sign } from './crypto';
import { signingKey } from './env';
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
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const signature = await sign(
      signingKey(this.env),
      `music:${projectId}:${manifest.preset}:${expires}`,
    );
    const body = JSON.stringify({
      version: 'ffmpeg-v1',
      origin: this.env.APP_ORIGIN,
      clips: await Promise.all(clips.map((id) => inferenceUrl(this.env, projectId, id))),
      portraits: await Promise.all(portraits.map((id) => inferenceUrl(this.env, projectId, id))),
      music: `${this.env.APP_ORIGIN}/api/inference/${projectId}/music/${manifest.preset}?expires=${expires}&signature=${signature}`,
    });
    const headers = { 'content-type': 'application/json' };
    const r = await this.env.RENDERER.getByName('media-1').fetch(
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
    const p = await this.env.RENDERER.getByName('media-1').fetch(
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
  }
}
