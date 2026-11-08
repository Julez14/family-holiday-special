import { describe, it, expect } from 'vitest';
import { compileManifest, PRESETS } from '../src/shared/presets';
import { manifestSchema, type CharacterInput } from '../src/shared/contracts';
import { outputExpiry, DAY, portraitQuality, canRepair, usdMicros } from '../src/shared/policies';
const cast = (n: number): CharacterInput[] =>
  Array.from({ length: n }, (_, i) => ({
    id: crypto.randomUUID(),
    sourceAssetId: crypto.randomUUID(),
    name: '',
    description: `Celebrates tiny successes with a ${i}-step victory wiggle.`,
    provenance: 'user',
    framing: 'manual',
    crop: { x: 0, y: 0, width: 1, height: 1 },
  }));
describe('deterministic preset compiler', () => {
  for (const p of PRESETS)
    for (let n = 1; n <= 6; n++)
      it(`${p.id}, ${n} people: covers everyone in four moving shots`, () => {
        const c = cast(n);
        const m = compileManifest(p.id, c, 31);
        expect(m.shots).toHaveLength(4);
        expect(new Set(m.shots.flatMap((s) => s.castIds))).toEqual(new Set(c.map((c) => c.id)));
        expect(m.shots.every((s) => s.castIds.length <= 2)).toBe(true);
        expect(m.shots.reduce<number>((t, s) => t + s.editSeconds, m.output.endCardSeconds)).toBe(
          20,
        );
        expect(compileManifest(p.id, c, 31)).toEqual(m);
        expect(
          m.shots.every((s) =>
            s.prompt.includes(c.find((c) => c.id === s.castIds[0])!.description),
          ),
        ).toBe(true);
        expect(m.cast.every((c) => c.name === '')).toBe(true);
      });
  it('rejects blank descriptions, foreign IDs and unknown story branches', () => {
    expect(() => compileManifest('snowball', [{ ...cast(1)[0], description: '' }], 1)).toThrow();
    const m = compileManifest('snowball', cast(6), 1);
    m.shots[0].castIds = [crypto.randomUUID()];
    expect(manifestSchema.safeParse(m).success).toBe(false);
    expect(manifestSchema.safeParse({ ...m, speech: 'hello' }).success).toBe(false);
  });
});
it('retains November outputs through Toronto January 31 and late January outputs for 30 days', () => {
  expect(outputExpiry(Date.parse('2026-11-08T00:00Z'))).toBe(Date.parse('2027-02-01T05:00Z'));
  const late = Date.parse('2027-01-30T12:00Z');
  expect(outputExpiry(late)).toBe(late + 30 * DAY);
});
it('rejects group/weak portraits and warns without fabricated identity scores', () => {
  expect(portraitQuality([]).usable).toBe(false);
  expect(
    portraitQuality([
      { width: 200, height: 200 },
      { width: 200, height: 200 },
    ]).usable,
  ).toBe(false);
  expect(portraitQuality([{ width: 63, height: 100 }]).usable).toBe(false);
  expect(portraitQuality([{ width: 95, height: 100 }]).message).toBeTruthy();
  expect(portraitQuality([{ width: 100, height: 120 }]).usable).toBe(true);
});
it('does not repair safety rejections, unknown submissions or exceed global repair caps', () => {
  expect(canRepair('video', 0, 'technical')).toBe(true);
  for (const reason of ['safety', 'submission_unknown', 'budget'])
    expect(canRepair('video', 0, reason)).toBe(false);
  expect(canRepair('video', 1, 'technical')).toBe(false);
  expect(canRepair('image', 2, 'technical')).toBe(false);
  expect(() => usdMicros(undefined)).toThrow();
});
