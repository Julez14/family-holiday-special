export const DAY = 86_400_000;
export function outputExpiry(completedAt: number, floor = '2027-02-01T05:00:00Z'): number {
  const campaign = Date.parse(floor);
  if (!Number.isFinite(campaign)) throw new Error('Invalid campaign retention floor.');
  return Math.max(completedAt + 30 * DAY, campaign);
}
export function usdMicros(value: string | undefined): number {
  const n = Number(value);
  if (!value || !Number.isFinite(n) || n <= 0)
    throw new Error('Positive spending configuration is required.');
  return Math.ceil(n * 1_000_000);
}
export function portraitQuality(
  faces: { width: number; height: number; clipped?: boolean }[],
  blur?: number,
): { usable: boolean; message?: string } {
  if (faces.length !== 1)
    return {
      usable: false,
      message:
        faces.length > 1
          ? 'There’s more than one face. Please use a separate photo of just this person.'
          : 'We couldn’t find a clear face. Try a brighter, closer individual portrait.',
    };
  const f = faces[0];
  if (Math.min(f.width, f.height) < 64)
    return {
      usable: false,
      message: 'This face is too small. Please replace it with a closer portrait.',
    };
  if (f.clipped)
    return {
      usable: true,
      message: 'Part of the head may be clipped. Include hair and accessories in your crop.',
    };
  if (Math.min(f.width, f.height) < 96)
    return { usable: true, message: 'A closer portrait will help keep this person recognizable.' };
  if (blur !== undefined && blur < 35)
    return {
      usable: true,
      message: 'This photo may be blurry. A sharper portrait usually works better.',
    };
  return { usable: true };
}
export const RETRY_CAPS = { image: 2, video: 1 } as const;
export function canRepair(kind: 'image' | 'video', repairsUsed: number, category: string): boolean {
  return repairsUsed < RETRY_CAPS[kind] && ['technical', 'transient'].includes(category);
}
