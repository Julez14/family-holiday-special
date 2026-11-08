import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

test('four individual portraits, manual framing fallback, editable cast, refresh, generation and sharing', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }),
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Simulate a genuinely unavailable browser detector; this must not claim automated verification.
  await page.route('**/vendor/blaze_face_short_range.tflite', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your family.');
  await expect(page.getByText('Results use illustrative fixtures', { exact: false })).toBeVisible();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-landing.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'See a sample' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').locator('video')).toHaveAttribute('controls', '');
  await page.getByRole('button', { name: 'Close sample' }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles([1, 2, 3, 4].map((n) => resolve(`public/fixtures/portrait-${n}.png`)));
  for (let n = 0; n < 4; n++) {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Face detection couldn’t run');
    await expect(dialog.getByRole('button', { name: 'Use this portrait' })).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Use this portrait' }).click();
    await expect(page.getByText('Ready for their close-up', { exact: true })).toHaveCount(n + 1);
  }
  await page.getByRole('button', { name: 'Meet the cast' }).click();
  await expect(
    page.getByRole('heading', { name: 'A little personality goes a long way.' }),
  ).toBeVisible();
  await expect(page.locator('textarea')).toHaveCount(4);
  const custom = 'An enthusiastic wrapper with an enormous victory pose and zero coordination.';
  await page.locator('textarea').first().fill(custom);
  await page.getByRole('button', { name: 'Choose for all empty descriptions' }).click();
  await expect(page.locator('textarea').first()).toHaveValue(custom);
  await expect
    .poll(async () =>
      page
        .locator('textarea')
        .evaluateAll((nodes) => nodes.every((n) => (n as HTMLTextAreaElement).value.length > 0)),
    )
    .toBe(true);
  await page.getByRole('button', { name: /Gift-Wrap Disaster All wrapped/ }).click();
  await expect(page.getByRole('button', { name: 'Generate my cartoon' })).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.waitForTimeout(850);
  await page.reload();
  await expect(page.locator('textarea').first()).toHaveValue(custom);
  await expect(
    page.getByRole('button', { name: /Gift-Wrap Disaster All wrapped/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-personalize.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Generate my cartoon' }).click();
  await expect(page.getByRole('heading', { name: /The group chat/ })).toBeVisible({
    timeout: 45000,
  });
  const video = page.locator('.result-video');
  await expect(video).toHaveAttribute('controls', '');
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(1);
  expect(await video.evaluate((el: HTMLVideoElement) => Math.abs(el.duration - 20))).toBeLessThan(
    0.12,
  );
  await video.evaluate((el: HTMLVideoElement) => {
    el.muted = true;
    return el.play();
  });
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0);
  await video.evaluate((el: HTMLVideoElement) => el.pause());
  await page.getByRole('button', { name: 'Share the holiday chaos' }).click();
  await expect(page.getByLabel('Anyone with this unlisted link can watch.')).toHaveValue(
    /\/s\/[a-f0-9]{64}/,
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-result.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Remove this cartoon' }).click();
  await page.getByRole('button', { name: 'Yes, remove cartoon' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your family.');
  expect(errors).toEqual([]);
});

for (const code of ['content_policy_violation:model_moderated', 'model_moderated']) {
  test(`clearly identifies a moderated cartoon (${code})`, async ({ page }) => {
    const id = '71975bc9-e410-4ab9-b9d0-20ea28781fd1';
    await page.route(`**/api/projects/${id}`, (route) =>
      route.fulfill({
        json: {
          id,
          state: 'failed',
          revision: 1,
          preset: 'giftwrap',
          characters: [],
          shots: [],
          mode: 'real',
          errorCode: code,
          error: `The AI provider blocked a request through content screening (${code.replace(':', '; ')}). It did not identify the exact trigger. Your completed artwork is saved.`,
          expiresAt: Date.now() + 86400000,
          costEstimateUsd: 1,
        },
      }),
    );
    await page.goto(`/p/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Content screeningstopped this cartoon.',
    );
    await expect(page.getByText(/AI provider blocked a request/)).toContainText('model_moderated');
    if (code.includes('content_policy_violation'))
      await expect(page.getByText(/AI provider blocked a request/)).toContainText(
        'content_policy_violation',
      );
    await expect(page.getByRole('button', { name: 'Start a new cartoon' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
