import { test, expect, chromium } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connectSidePanel, type SidePanelDriver } from './panel-driver';

let context: BrowserContext;
let worker: Worker;
let page: Page;
let panel: SidePanelDriver;
let profile: string;
let extensionId: string;

test.beforeEach(async ({}, testInfo) => {
  profile = await mkdtemp(path.join(tmpdir(), 'stillpoint-extension-e2e-'));
  const extension = path.resolve('extension-dist');
  const executable = process.env.STILLPOINT_CHROMIUM_EXECUTABLE;
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', executablePath: executable, headless: process.env.STILLPOINT_EXTENSION_HEADED !== '1', viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--enable-unsafe-extension-debugging', '--use-fake-device-for-media-stream', ...(testInfo.title.includes('native camera permission') ? [] : ['--use-fake-ui-for-media-stream']), '--enable-unsafe-swiftshader'],
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  page = context.pages()[0] ?? await context.newPage();
  await page.goto('http://127.0.0.1:5173/extension-e2e/player.html');
});

test.afterEach(async () => {
  await panel?.close().catch(() => {});
  await context?.close();
  const resolved = path.resolve(profile);
  if (resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith('stillpoint-extension-e2e-')) await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
});

async function openPanel() {
  const cdp = await context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const target = targetInfos.find(info => info.url === page.url());
  expect(target).toBeTruthy();
  // Fresh profiles must finish registering their manifest side-panel options before the action.
  await expect.poll(() => worker.evaluate(async () => (await chrome.sidePanel.getOptions({})).path)).toBe('panel.html');
  await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: target!.targetId });
  try { panel = await connectSidePanel(context, extensionId); }
  catch (error) {
    console.log('SIDE_PANEL_TARGETS_ON_FAILURE', await cdp.send('Target.getTargets').catch(() => ({})));
    throw error;
  }
  await cdp.detach();
  await expect.poll(() => panel.evaluate<string>('document.querySelector("h1")?.textContent')).toBe('Your video, at your pace.');
  await expect.poll(() => panel.evaluate<boolean>(`!document.querySelector('button[aria-label="Play selected video"]')?.disabled`)).toBe(true);
}

const isPaused = () => page.locator('video').evaluate(video => (video as HTMLVideoElement).paused);

test('first-time native camera permission opens a window and cancellation leaves the camera off', async () => {
  await openPanel();
  const created = context.waitForEvent('page', { timeout: 8000 });
  await panel.click('.extension-camera > button.primary');
  const permission = await created;
  await expect(permission).toHaveURL(new RegExp(`^chrome-extension://${extensionId}/camera-permission.html`));
  await expect(permission.locator('#permission-title')).toContainText(/camera/i);
  expect(await permission.evaluate(() => document.hasFocus())).toBe(true);
  expect(await panel.evaluate('document.querySelector("video").srcObject')).toBeNull();
  if (process.env.STILLPOINT_EXTENSION_HEADED === '1') {
    const cdp = await context.browser()!.newBrowserCDPSession();
    await expect.poll(async () => {
      const result = await cdp.send('Browser.getHistograms', { query: 'Permissions.Prompt.VideoCapture.ShownInActiveBrowser' });
      return result.histograms.find(item => item.name === 'Permissions.Prompt.VideoCapture.ShownInActiveBrowser')?.count ?? 0;
    }).toBeGreaterThan(0);
    await expect(permission.locator('#permission-title')).toHaveText('Allow your camera');
    expect(await permission.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await permission.screenshot({ path: path.join(tmpdir(), 'stillpoint-camera-permission.png') });
    await cdp.detach();
  }
  await permission.close();
  await expect.poll(() => panel.evaluate<string>('document.querySelector(".tracking-status")?.textContent')).toBe('Camera off');
  await expect.poll(() => panel.evaluate<string>('document.body.textContent')).toContain('Camera permission window was closed');
  expect(await panel.evaluate('document.querySelector("video").srcObject')).toBeNull();
  expect(await worker.evaluate(async () => {
    const saved = (await chrome.storage.session.get('stillpointSession')).stillpointSession as { connected: boolean };
    return saved.connected;
  })).toBe(true);
});

test('native camera permission grant returns to calibration and subsequent starts reuse consent', async () => {
  await openPanel();
  const created = context.waitForEvent('page', { timeout: 8000 });
  await panel.click('.extension-camera > button.primary');
  const permission = await created;
  await expect(permission).toHaveURL(new RegExp(`^chrome-extension://${extensionId}/camera-permission.html`));
  // Headless Chrome denies unanswered native prompts. Model the user's Allow choice
  // only in this isolated synthetic-device profile, then retry the real popup request.
  await expect(permission.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  // CDP treats chrome-extension origins as opaque, so the permission override is
  // scoped to this disposable browser context rather than an origin pattern.
  await context.grantPermissions(['camera']);
  await permission.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => permission.isClosed()).toBe(true);
  await expect.poll(() => panel.evaluate<string>('document.querySelector(".tracking-status")?.textContent'), { timeout: 35000 }).toBe('Calibrating your position');
  await panel.evaluate('window.testTrack = document.querySelector("video").srcObject.getVideoTracks()[0]');
  await panel.click('.extension-camera > button.primary');
  expect(await panel.evaluate<string>('window.testTrack.readyState')).toBe('ended');
  const pages = context.pages().length;
  await panel.click('.extension-camera > button.primary');
  await expect.poll(() => panel.evaluate<string>('document.querySelector(".tracking-status")?.textContent'), { timeout: 35000 }).toBe('Calibrating your position');
  expect(context.pages()).toHaveLength(pages);
  expect(panel.exceptions).toEqual([]);
});

test('native camera permission request is cancelled when the selected video tab changes', async () => {
  await openPanel();
  const created = context.waitForEvent('page', { timeout: 8000 });
  await panel.click('.extension-camera > button.primary');
  const permission = await created;
  await expect(permission).toHaveURL(new RegExp(`^chrome-extension://${extensionId}/camera-permission.html`));
  const other = await context.newPage();
  await other.goto('http://127.0.0.1:5173/');
  await other.bringToFront();
  await expect.poll(() => permission.isClosed()).toBe(true);
  await expect.poll(() => panel.evaluate<string>('document.querySelector(".tracking-status")?.textContent')).toBe('Camera off');
  expect(await panel.evaluate('document.querySelector("video").srcObject')).toBeNull();
});

test('native camera permission window closes when the initiating panel reloads', async () => {
  await openPanel();
  const created = context.waitForEvent('page', { timeout: 8000 });
  await panel.click('.extension-camera > button.primary');
  const permission = await created;
  await expect(permission).toHaveURL(new RegExp(`^chrome-extension://${extensionId}/camera-permission.html`));
  await panel.send('Page.reload');
  await expect.poll(() => permission.isClosed()).toBe(true);
  await expect.poll(() => panel.evaluate<string>('document.querySelector(".tracking-status")?.textContent')).toBe('Camera off');
  expect(await panel.evaluate('document.querySelector("video").srcObject')).toBeNull();
});

test('actual toolbar grants activeTab, opens the panel and controls a different page without installed host grants', async () => {
  const origins = await worker.evaluate(async () => (await chrome.permissions.getAll()).origins ?? []);
  expect(origins).toEqual([]);
  const denied = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => document.title }); return false; } catch { return true; }
  });
  expect(denied).toBe(true);
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await expect.poll(isPaused).toBe(false);
  await openPanel();
  await panel.click('button[aria-label="Pause selected video"]');
  await expect.poll(isPaused).toBe(true);
  await panel.click('button[aria-label="Play selected video"]');
  await expect.poll(isPaused).toBe(false);
  expect(panel.exceptions).toEqual([]);
  await panel.screenshot(path.join(tmpdir(), 'stillpoint-extension-panel.png'));
});

test('side-panel simulation pauses and resumes real selected video while preserving manual pause', async () => {
  await openPanel();
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await expect.poll(isPaused).toBe(false);
  await panel.click('.extension-camera > button.outline');
  await expect.poll(() => panel.evaluate<string>('document.querySelector(".tracking-status")?.textContent')).toBe('Simulation mode');
  await panel.click('#auto-resume');
  await panel.click('.pose-buttons button:nth-child(2)');
  await expect.poll(isPaused).toBe(true);
  await panel.click('.pose-buttons button:first-child');
  await expect.poll(isPaused).toBe(false);
  await page.getByRole('button', { name: 'Pause lesson', exact: true }).click();
  await panel.click('.pose-buttons button:nth-child(2)');
  await page.waitForTimeout(500);
  await panel.click('.pose-buttons button:first-child');
  await page.waitForTimeout(1500);
  expect(await isPaused()).toBe(true);
});

test('packaged worker and local model run under extension CSP and stop the synthetic camera', async () => {
  await openPanel();
  await panel.click('.extension-camera > button.primary');
  await expect.poll(() => panel.evaluate<string>('document.querySelector(".tracking-status")?.textContent'), { timeout: 35000 }).toBe('Calibrating your position');
  expect(await panel.evaluate<boolean>('document.querySelector("video").srcObject.getVideoTracks()[0].readyState === "live"')).toBe(true);
  await panel.evaluate('window.testTrack = document.querySelector("video").srcObject.getVideoTracks()[0]');
  await panel.click('.extension-camera > button.primary');
  expect(await panel.evaluate<string>('window.testTrack.readyState')).toBe('ended');
  expect(await panel.evaluate('document.querySelector("video").srcObject')).toBeNull();
  expect(panel.exceptions).toEqual([]);
});

test('switching tabs invalidates the selected session and suspends assistance', async () => {
  await openPanel();
  await panel.click('.extension-camera > button.outline');
  const other = await context.newPage();
  await other.goto('http://127.0.0.1:5173/');
  await other.bringToFront();
  await expect.poll(() => worker.evaluate(async () => {
    const saved = (await chrome.storage.session.get('stillpointSession')).stillpointSession as { connected?: boolean } | undefined;
    return saved?.connected;
  })).toBe(false);
  await expect.poll(() => panel.evaluate<string>('document.querySelector(".tracking-status")?.textContent')).toBe('Camera off');
});

test('reloading the panel starts a usable observation stream after a long previous session', async () => {
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await openPanel();
  const seeded = await panel.evaluate<{ ok: boolean }>(`(async () => {
    const saved = await chrome.storage.session.get('stillpointSession');
    return chrome.runtime.sendMessage({channel:'stillpoint-extension-v1',type:'POSE',token:saved.stillpointSession.token,observation:{pose:'facing',capturedAt:performance.timeOrigin+performance.now(),sequence:999999}});
  })()`);
  expect(seeded.ok).toBe(true);
  await panel.send('Page.reload');
  await expect.poll(() => panel.evaluate<string>('document.querySelector("h1")?.textContent')).toBe('Your video, at your pace.');
  await expect.poll(() => panel.evaluate<boolean>('!document.querySelector(".extension-camera > button.outline")?.disabled')).toBe(true);
  await panel.click('.extension-camera > button.outline');
  await panel.click('.pose-buttons button:nth-child(2)');
  await expect.poll(isPaused, { timeout: 4500 }).toBe(true);
});

test('a waiting media request does not block Pause or the panel connection', async () => {
  await page.getByRole('button', { name: 'Play lesson', exact: true }).click();
  await openPanel();
  await page.route('**/never-finishes.mp4', () => {});
  await page.locator('video').evaluate(video => { (video as HTMLVideoElement).src = '/never-finishes.mp4'; });
  await expect.poll(() => page.locator('video').evaluate(video => (video as HTMLVideoElement).readyState)).toBe(0);
  const acknowledgement = await panel.evaluate<{ ok: boolean }>(`(async () => {
    const saved = await chrome.storage.session.get('stillpointSession');
    return chrome.runtime.sendMessage({channel:'stillpoint-extension-v1',type:'TARGET_ACTION',token:saved.stillpointSession.token,action:'play'});
  })()`);
  expect(acknowledgement.ok).toBe(true);
  await panel.click('button[aria-label="Pause selected video"]');
  await expect.poll(isPaused).toBe(true);
  expect(await panel.evaluate<boolean>('!document.querySelector(".target-controls button")?.disabled')).toBe(true);
});

test('a page without a visible video reports that limitation without changing the page', async () => {
  await openPanel();
  await page.locator('video').evaluate(video => video.remove());
  await expect.poll(() => panel.evaluate<string>('document.querySelector(".target-message")?.textContent')).toContain('No visible standard video');
  expect(await panel.evaluate<boolean>('document.querySelector(".target-controls button").disabled')).toBe(true);
  await expect(page.getByRole('heading', { name: 'Practice lesson on another page' })).toBeVisible();
});
