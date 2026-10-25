import { expect, test } from '@playwright/test';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['camera'],
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type Fixture = { away: boolean; freeze: boolean; delivered: boolean };
    const fixture: Fixture = { away: false, freeze: false, delivered: false };
    (window as unknown as { trackingFixture: Fixture }).trackingFixture = fixture;
    class ControlledWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      onmessageerror = null;
      stopped = false;
      postMessage(message: { type: string; timestamp: number; bitmap?: ImageBitmap }) {
        if (message.type === 'init') { setTimeout(() => this.onmessage?.({ data: { type: 'ready' } } as MessageEvent), 0); return; }
        message.bitmap?.close();
        if (this.stopped || (fixture.freeze && fixture.delivered)) return;
        fixture.delivered = true;
        const matrix = fixture.away ? [0.8660254038, 0, -0.5, 0, 0, 1, 0, 0, 0.5, 0, 0.8660254038, 0, 0, 0, 0, 1] : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        setTimeout(() => { if (!this.stopped) this.onmessage?.({ data: { type: 'result', timestamp: message.timestamp, faceCount: 1, matrix } } as MessageEvent); }, 0);
      }
      terminate() { this.stopped = true; }
    }
    window.Worker = ControlledWorker as unknown as typeof Worker;
  });
});

test('a single away observation followed by stalled inference cannot trigger a delayed pause', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Facing the screen', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await page.evaluate(() => Object.assign((window as unknown as { trackingFixture: object }).trackingFixture, { away: true, freeze: true, delivered: false }));
  await expect(page.getByRole('status')).toContainText('Looking away');
  await expect(page.getByRole('status')).toContainText('Tracking uncertain', { timeout: 1_500 });
  await page.waitForTimeout(2_100);
  expect(await page.locator('video[aria-label="Practice lesson video"]').evaluate(video => (video as HTMLVideoElement).paused)).toBe(false);
});

test('a single return observation followed by a stall cannot resume at the minimum return delay', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Facing the screen', { timeout: 10_000 });
  await page.getByRole('switch', { name: 'Resume automatically' }).click();
  await page.locator('#return-delay').press('Home');
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await page.evaluate(() => Object.assign((window as unknown as { trackingFixture: object }).trackingFixture, { away: true, freeze: false }));
  await expect.poll(() => page.locator('video[aria-label="Practice lesson video"]').evaluate(video => (video as HTMLVideoElement).paused)).toBe(true);
  await page.evaluate(() => Object.assign((window as unknown as { trackingFixture: object }).trackingFixture, { away: false, freeze: true, delivered: false }));
  await expect(page.getByRole('status')).toContainText('Tracking uncertain', { timeout: 1_500 });
  await page.waitForTimeout(800);
  expect(await page.locator('video[aria-label="Practice lesson video"]').evaluate(video => (video as HTMLVideoElement).paused)).toBe(true);
});

test('changing sensitivity restarts a pending pause countdown', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try without a camera', exact: true }).click();
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await page.getByRole('button', { name: 'Look away', exact: true }).click();
  await expect(page.getByText('Pausing in a moment…')).toBeVisible();
  await page.waitForTimeout(1_000);
  await page.getByLabel('Sensitivity', { exact: true }).selectOption('relaxed');
  await page.waitForTimeout(1_100);
  expect(await page.locator('video[aria-label="Practice lesson video"]').evaluate(video => (video as HTMLVideoElement).paused)).toBe(false);
  await expect.poll(() => page.locator('video[aria-label="Practice lesson video"]').evaluate(video => (video as HTMLVideoElement).paused)).toBe(true);
});

test('delayed browser timers cannot act on a pose after its capture deadline', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Facing the screen', { timeout: 10_000 });
  await page.locator('#pause-delay').press('Home');
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await page.evaluate(() => Object.assign((window as unknown as { trackingFixture: object }).trackingFixture, { away: true, freeze: true, delivered: false }));
  await expect(page.getByText('Pausing in a moment…')).toBeVisible();
  await page.evaluate(() => {
    const start = performance.now();
    while (performance.now() - start < 1_500) { /* Simulate a long task delaying both timers. */ }
  });
  await expect(page.getByRole('status')).toContainText('Tracking uncertain');
  expect(await page.locator('video[aria-label="Practice lesson video"]').evaluate(video => (video as HTMLVideoElement).paused)).toBe(false);
});
