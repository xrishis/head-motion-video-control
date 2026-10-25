import { expect, test } from '@playwright/test';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-unsafe-swiftshader'] },
  permissions: ['camera'],
});

test('real local model initializes with a synthetic camera and releases its live track on disable', async ({ page }) => {
  const assets: { url: string; status: number }[] = [];
  const errors: string[] = [];
  page.on('response', response => {
    if (/\/mediapipe\/|face_landmarker\.task/.test(response.url())) assets.push({ url: response.url(), status: response.status() });
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByText('Calibrating your position', { exact: true })).toBeVisible({ timeout: 35_000 });
  await expect(page.locator('.camera-guidance')).toContainText('No face found', { timeout: 10_000 });
  const track = await page.locator('video[aria-label="Local camera preview"]').evaluateHandle(video => (video as HTMLVideoElement).srcObject instanceof MediaStream ? ((video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0] : null);
  expect(await track.evaluate(value => value?.readyState)).toBe('live');
  expect(assets.some(item => item.url.endsWith('/models/face_landmarker.task') && item.status === 200)).toBe(true);
  expect(assets.some(item => item.url.endsWith('/mediapipe/vision_wasm_module_internal.wasm') && item.status === 200)).toBe(true);
  expect(assets.every(item => new URL(item.url).origin === 'http://127.0.0.1:5173' && item.status === 200 && !item.url.includes('/mediapipe//'))).toBe(true);
  await page.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(page.getByText('Camera off', { exact: true })).toBeVisible();
  expect(await track.evaluate(value => value?.readyState)).toBe('ended');
  expect(await page.locator('video[aria-label="Local camera preview"]').evaluate(video => (video as HTMLVideoElement).srcObject)).toBeNull();
  expect(errors).toEqual([]);
});

test('disabling during a delayed camera permission result stops the late stream', async ({ page }) => {
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints);
      (window as unknown as { lateTrack: MediaStreamTrack }).lateTrack = stream.getVideoTracks()[0];
      await new Promise(resolve => setTimeout(resolve, 800));
      return stream;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await page.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { lateTrack?: MediaStreamTrack }).lateTrack?.readyState)).toBe('ended');
  await expect(page.getByText('Camera off', { exact: true })).toBeVisible();
  expect(await page.locator('video[aria-label="Local camera preview"]').evaluate(video => (video as HTMLVideoElement).srcObject)).toBeNull();
});

test('a missing model gives an actionable failure and keeps simulation usable', async ({ page }) => {
  await page.route('**/models/face_landmarker.task', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByText('Camera unavailable', { exact: true })).toBeVisible({ timeout: 35_000 });
  await expect(page.getByRole('alert')).toContainText('manual playback or simulation');
  expect(await page.locator('video[aria-label="Local camera preview"]').evaluate(video => (video as HTMLVideoElement).srcObject)).toBeNull();
  await page.getByRole('button', { name: 'Try without a camera', exact: true }).click();
  await expect(page.getByText('Simulation mode', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await expect.poll(() => page.locator('video[aria-label="Practice lesson video"]').evaluate(video => (video as HTMLVideoElement).paused)).toBe(false);
});
