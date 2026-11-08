import { z } from 'zod';

export const presetId = z.enum(['snowball', 'giftwrap', 'danceoff']);
export type PresetId = z.infer<typeof presetId>;
export const projectState = z.enum([
  'draft',
  'queued',
  'creating_cast',
  'creating_frames',
  'animating',
  'rendering',
  'ready',
  'failed',
  'deleting',
  'deleted',
  'expired',
]);
export type ProjectState = z.infer<typeof projectState>;
export const cropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine(
    (c) => c.x + c.width <= 1.001 && c.y + c.height <= 1.001,
    'Keep the crop inside the photo.',
  );
export type Crop = z.infer<typeof cropSchema>;
export const characterSchema = z
  .object({
    id: z.string().uuid(),
    sourceAssetId: z.string().uuid(),
    name: z.string().trim().max(60).default(''),
    description: z.string().trim().max(500),
    provenance: z.enum(['user', 'llm']).default('user'),
    crop: cropSchema,
    framing: z.enum(['detected', 'manual']),
  })
  .strict();
export type CharacterInput = z.infer<typeof characterSchema>;
export const castUpdateSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    preset: presetId.nullable(),
    characters: z.array(characterSchema).max(6),
  })
  .strict();
export const descriptionsSchema = z
  .object({ characterIds: z.array(z.string().uuid()).min(1).max(6), onlyEmpty: z.boolean() })
  .strict();
export const uploadSchema = z
  .object({
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    size: z
      .number()
      .int()
      .positive()
      .max(15 * 1024 * 1024),
  })
  .strict();
export const generateSchema = z
  .object({ turnstileToken: z.string().max(2048).optional() })
  .strict();
export const descriptionOutputSchema = z
  .object({
    descriptions: z
      .array(
        z
          .object({ id: z.string().uuid(), description: z.string().trim().min(1).max(500) })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
export const reviewSchema = z
  .object({ verdict: z.enum(['pass', 'clear_failure', 'uncertain']), reason: z.string().max(240) })
  .strict();
export type Character = CharacterInput & {
  sourceUrl: string;
  canonicalUrl?: string;
  wardrobe?: string;
};
export type AssetKind = 'source' | 'crop' | 'portrait' | 'frame' | 'clip' | 'video' | 'poster';
export interface ProjectView {
  id: string;
  state: ProjectState;
  revision: number;
  preset: PresetId | null;
  characters: Character[];
  shots: { id: string; order: number; frameUrl?: string; clipReady: boolean }[];
  mode: 'mock' | 'real';
  error?: string;
  expiresAt: number;
  videoUrl?: string;
  posterUrl?: string;
  shareUrl?: string;
  costEstimateUsd: number;
}
export const STYLE_VERSION = 'theatrical-2d-v1';
export const PROMPT_VERSION = 'holiday-gags-v1';
export const STYLE =
  'Looney Tunes animation style; original human characters, classic hand-drawn 2D theatrical cartoon, bold clean outlines, painted backgrounds, expressive silhouettes, bright festive colors, comic anticipation, squash and stretch. Preserve visible skin tones, distinctive hair, glasses, facial hair, facial proportions and accessories. No existing cartoon characters, brand marks, lettering, photorealism or 3D rendering.';

export const shotSchema = z
  .object({
    id: z.string(),
    order: z.number().int().min(0).max(3),
    castIds: z.array(z.string().uuid()).min(1).max(2),
    action: z.string(),
    setting: z.string(),
    framing: z.string(),
    prompt: z.string(),
    requestedSeconds: z.literal(5),
    editSeconds: z.literal(4.5),
  })
  .strict();
export const manifestSchema = z
  .object({
    version: z.literal(1),
    preset: presetId,
    presetVersion: z.literal(1),
    styleVersion: z.literal(STYLE_VERSION),
    promptVersion: z.literal(PROMPT_VERSION),
    seed: z.number().int(),
    cast: z
      .array(characterSchema.extend({ wardrobe: z.string() }))
      .min(1)
      .max(6),
    shots: z.array(shotSchema).length(4),
    musicKey: z.string(),
    output: z
      .object({
        width: z.literal(1280),
        height: z.literal(720),
        fps: z.literal(24),
        seconds: z.literal(20),
        endCardSeconds: z.literal(2),
        audio: z.literal('music-only'),
      })
      .strict(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const cast = new Set(m.cast.map((c) => c.id));
    if (cast.size !== m.cast.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate cast IDs.' });
    if (m.cast.some((c) => !c.description.trim()))
      ctx.addIssue({ code: 'custom', message: 'Every character needs a description.' });
    const covered = new Set(m.shots.flatMap((s) => s.castIds));
    if ([...covered].some((id) => !cast.has(id)) || [...cast].some((id) => !covered.has(id)))
      ctx.addIssue({
        code: 'custom',
        message: 'Every selected person must appear in a moving shot.',
      });
    if (m.shots.some((s, i) => s.order !== i || new Set(s.castIds).size !== s.castIds.length))
      ctx.addIssue({ code: 'custom', message: 'Invalid shot allocation.' });
  });
export type Manifest = z.infer<typeof manifestSchema>;
