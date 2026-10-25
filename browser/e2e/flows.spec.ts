import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

const lesson = (page: Page) => page.getByLabel('Practice lesson video', { exact: true });
const isPaused = (page: Page) => lesson(page).evaluate((video: HTMLVideoElement) => video.paused);

async function playLesson(page: Page) {
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect.poll(() => isPaused(page)).toBe(false);
  await expect.poll(() => lesson(page).evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.1);
}

async function simulate(page: Page, autoResume = false) {
  await page.getByRole('button', { name: 'Try without a camera', exact: true }).click();
  await expect(page.getByText('Simulated head direction · no camera', { exact: true })).toBeVisible();
  await page.getByRole('slider', { name: /Pause after looking away/ }).press('Home');
  await page.getByRole('slider', { name: /Return delay/ }).press('Home');
  if (autoResume) await page.getByRole('switch', { name: 'Resume automatically' }).click();
}

async function assistantPause(page: Page) {
  await page.getByRole('button', { name: 'Look away', exact: true }).click();
  await expect.poll(() => isPaused(page), { timeout: 4000 }).toBe(true);
  await expect(page.getByText('Paused while you look away', { exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('sample metadata and controls drive real media without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Reload after listeners attach so startup failures are part of this assertion.
  await page.reload();
  await expect(page).toHaveTitle(/Stillpoint/);
  await expect(page).toHaveURL('http://127.0.0.1:5173/');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect.poll(() => lesson(page).evaluate((video: HTMLVideoElement) => video.duration)).toBeCloseTo(60, 0);
  await expect(page.getByRole('button', { name: 'Enable camera', exact: true })).toBeVisible();
  await playLesson(page);
  await page.getByRole('button', { name: 'Pause video', exact: true }).click();
  await expect.poll(() => isPaused(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('simulation pauses a playing lesson only after the selected sustained delay', async ({ page }) => {
  await page.getByRole('button', { name: 'Try without a camera', exact: true }).click();
  await playLesson(page);
  await page.getByRole('button', { name: 'Look away', exact: true }).click();
  await expect(page.getByText('Pausing in a moment…', { exact: true })).toBeVisible();
  await page.waitForTimeout(650);
  expect(await isPaused(page)).toBe(false);
  await expect.poll(() => isPaused(page), { timeout: 4000 }).toBe(true);
  await expect(page.getByText('Paused while you look away', { exact: true })).toBeVisible();
});

test('automatic resume defaults off and returning to the screen keeps the lesson paused', async ({ page }) => {
  await simulate(page);
  await expect(page.getByRole('switch', { name: 'Resume automatically' })).not.toBeChecked();
  await playLesson(page);
  await assistantPause(page);
  await page.getByRole('button', { name: 'Face screen', exact: true }).click();
  await page.waitForTimeout(1000);
  expect(await isPaused(page)).toBe(true);
});

test('opting into automatic resume continues a lesson paused by the assistant', async ({ page }) => {
  await simulate(page, true);
  await expect(page.getByRole('switch', { name: 'Resume automatically' })).toBeChecked();
  await playLesson(page);
  await assistantPause(page);
  await page.getByRole('button', { name: 'Face screen', exact: true }).click();
  await expect.poll(() => isPaused(page), { timeout: 3000 }).toBe(false);
  await expect(page.getByRole('button', { name: 'Pause video', exact: true })).toBeVisible();
});

test('a manual pause remains paused after an away and return cycle', async ({ page }) => {
  await simulate(page, true);
  await playLesson(page);
  await page.getByRole('button', { name: 'Pause video', exact: true }).click();
  await expect.poll(() => isPaused(page)).toBe(true);
  await page.getByRole('button', { name: 'Look away', exact: true }).click();
  await page.waitForTimeout(1400);
  await page.getByRole('button', { name: 'Face screen', exact: true }).click();
  await page.waitForTimeout(1000);
  expect(await isPaused(page)).toBe(true);
  await expect(page.getByText('Paused while you look away', { exact: true })).toHaveCount(0);
});

test('exiting simulation cancels a pending automatic pause', async ({ page }) => {
  await simulate(page, true);
  await playLesson(page);
  await page.getByRole('button', { name: 'Look away', exact: true }).click();
  await expect(page.getByText('Pausing in a moment…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Exit simulation', exact: true }).click();
  await expect(page.getByText('Camera off', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Look away', exact: true })).toHaveCount(0);
  await page.waitForTimeout(1400);
  expect(await isPaused(page)).toBe(false);
});

test('a local video opens from the file picker and lesson changes clear resume ownership', async ({ page }) => {
  await simulate(page, true);
  await playLesson(page);
  await assistantPause(page);
  await expect(page.getByLabel('Choose a local video', { exact: true })).toHaveCount(1);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open your video', exact: true }).click();
  await (await chooser).setFiles(path.resolve('public/demo/lesson.mp4'));
  await expect(page.getByRole('heading', { name: 'lesson.mp4', exact: true })).toBeVisible();
  await expect.poll(() => lesson(page).evaluate((video: HTMLVideoElement) => video.currentSrc)).toMatch(/^blob:/);
  await expect.poll(() => lesson(page).evaluate((video: HTMLVideoElement) => video.duration)).toBeCloseTo(60, 0);
  await page.getByRole('button', { name: 'Face screen', exact: true }).click();
  await page.waitForTimeout(1000);
  expect(await isPaused(page)).toBe(true);
  await expect(page.getByText('Paused while you look away', { exact: true })).toHaveCount(0);
  await playLesson(page);
  await page.getByRole('button', { name: 'Back to sample lesson', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your practice lesson', exact: true })).toBeVisible();
  await expect.poll(() => lesson(page).evaluate((video: HTMLVideoElement) => video.currentSrc)).toMatch(/\/demo\/lesson\.mp4$/);
  await expect.poll(() => isPaused(page)).toBe(true);
  await page.waitForTimeout(900);
  expect(await isPaused(page)).toBe(true);
});

test('help and expandable lesson notes work with keyboard dismissal', async ({ page }) => {
  const note = page.getByRole('button', { name: /Settle into your natural position/ });
  await expect(note).toHaveAttribute('aria-expanded', 'false');
  await note.click();
  await expect(note).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(/Place your webcam near the top of your screen/)).toBeVisible();
  await note.click();
  await expect(note).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'How it works', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close help', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'How it works', exact: true }).click();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('390-pixel layout keeps controls usable without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Play video', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try without a camera', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await playLesson(page);
  await page.getByRole('button', { name: 'Pause video', exact: true }).click();
  expect(await isPaused(page)).toBe(true);
  await page.screenshot({ path: path.join(os.tmpdir(), 'stillpoint-mobile-e2e.png'), fullPage: true });
});

test('explicit camera denial leaves manual playback and simulation usable', async ({ page }) => {
  await page.addInitScript(() => {
    const requests: MediaStreamConstraints[] = [];
    Object.defineProperty(window, 'cameraRequests', { value: requests });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        requests.push(constraints);
        throw new DOMException('Permission denied for browser test', 'NotAllowedError');
      },
    });
  });
  await page.reload();
  const requests = () => page.evaluate(() => (window as unknown as { cameraRequests: MediaStreamConstraints[] }).cameraRequests);
  expect(await requests()).toEqual([]);
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/permission was denied/);
  expect(await requests()).toEqual([{ video: expect.any(Object), audio: false }]);
  await playLesson(page);
  await simulate(page);
  await assistantPause(page);
  expect(await requests()).toHaveLength(1);
});
