import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionVideoController } from './videoController';
import { CHANNEL, DEFAULT_SETTINGS, epochNow, type ExtensionSettings, type Observation, type VideoStatus } from './protocol';
import { installContent } from './content';

// A media boundary keeps real policy/timer/event behavior under test. Browser
// packaging tests additionally exercise actual HTMLVideoElement playback.
class Video extends EventTarget {
  readonly tagName = 'VIDEO';
  paused = false;
  ended = false;
  seeking = false;
  readyState = 4;
  currentTime = 20;
  currentSrc = 'https://example.test/lesson.mp4';
  src = this.currentSrc;
  srcObject: unknown = null;
  isConnected = true;
  parentElement = null;
  hidden = false;
  style = { display: 'block', visibility: 'visible', opacity: '1' };
  rect = { x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 };
  deferredPlay: (() => void) | null = null;
  blockPlay = false;
  queueEvents = false;
  private queuedEvents: string[] = [];
  getBoundingClientRect() { return this.rect; }
  getClientRects() { return [this.rect]; }
  contains(target: unknown) { return target === this; }
  closest() { return null; }
  private emit(type: string) { if (this.queueEvents) this.queuedEvents.push(type); else this.dispatchEvent(new Event(type)); }
  flushEvents() { while (this.queuedEvents.length) this.dispatchEvent(new Event(this.queuedEvents.shift()!)); }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.emit('pause');
  }
  play(): Promise<void> {
    if (this.blockPlay) return Promise.reject(new Error('A click is required'));
    if (this.deferredPlay) {
      return new Promise(resolve => {
        this.deferredPlay = () => { this.paused = false; this.emit('play'); resolve(); };
      });
    }
    this.paused = false;
    this.emit('play');
    return Promise.resolve();
  }
}

class Page extends EventTarget {
  hidden = false;
  location = { hostname: 'example.test' };
  videos: Video[] = [];
  youtube: Video | null = null;
  defaultView = {
    innerWidth: 1280, innerHeight: 720,
    getComputedStyle: (element: Video) => element.style,
  };
  querySelectorAll() { return this.videos; }
  querySelector() { return this.youtube; }
  contains(video: Video) { return this.videos.includes(video) && video.isConnected; }
}

const settings: ExtensionSettings = { ...DEFAULT_SETTINGS, pauseDelayMs: 1000, returnDelayMs: 500, autoResume: true };
let time = 100_000;
let sequence = 0;
const controllers: ExtensionVideoController[] = [];
function setup(videos = [new Video()], options = settings) {
  const page = new Page();
  page.videos = videos;
  const controller = new ExtensionVideoController(page as unknown as Document, options, 'test-session', () => time);
  controllers.push(controller);
  return { page, video: videos[0], controller };
}
function observe(controller: ExtensionVideoController, pose: Observation['pose'], age = 0, seq = ++sequence) {
  controller.observe({ pose, capturedAt: time - age, sequence: seq });
}
function advance(controller: ExtensionVideoController, duration: number, pose: Observation['pose']) {
  for (let elapsed = 0; elapsed < duration; elapsed += 100) {
    time += Math.min(100, duration - elapsed);
    observe(controller, pose);
  }
}

beforeEach(() => { vi.useFakeTimers(); time = 100_000; sequence = 0; });
afterEach(() => { for (const controller of controllers.splice(0)) controller.destroy(); vi.useRealTimers(); });

describe('ExtensionVideoController', () => {
  it('controls only the largest visible standard video after sustained fresh observations', () => {
    const thumbnail = new Video();
    thumbnail.rect = { ...thumbnail.rect, width: 80, height: 45, right: 80, bottom: 45 };
    const hidden = new Video(); hidden.style.display = 'none';
    const lesson = new Video();
    const { controller } = setup([thumbnail, hidden, lesson]);
    observe(controller, 'away');
    advance(controller, 900, 'away');
    expect(lesson.paused).toBe(false);
    advance(controller, 100, 'away');
    expect(lesson.paused).toBe(true);
    expect(thumbnail.paused).toBe(false);
    expect(hidden.paused).toBe(false);
    expect(controller.status()).toMatchObject({ videoFound: true, ownsPause: true });
  });

  it('prefers a visible YouTube main player over another larger video', () => {
    const lesson = new Video();
    const other = new Video(); other.rect = { ...other.rect, width: 1000, height: 600, right: 1000, bottom: 600 };
    const { page, controller } = setup([lesson, other]);
    page.youtube = lesson;
    observe(controller, 'away'); advance(controller, 1000, 'away');
    expect(lesson.paused).toBe(true);
    expect(other.paused).toBe(false);
  });

  it('never makes a decision from a stale final signal when the timer was delayed', () => {
    const { video, controller } = setup();
    observe(controller, 'away'); advance(controller, 900, 'away');
    time += 1000;
    vi.advanceTimersByTime(100);
    expect(video.paused).toBe(false);
    expect(controller.status().pending).toBeNull();
    observe(controller, 'away'); advance(controller, 900, 'away');
    expect(video.paused).toBe(false);
    advance(controller, 100, 'away');
    expect(video.paused).toBe(true);
  });

  it('expires pause ownership independently of incoming observations', () => {
    const { video, controller } = setup();
    observe(controller, 'away'); advance(controller, 1000, 'away');
    time += 351;
    vi.advanceTimersByTime(100);
    expect(controller.status().ownsPause).toBe(false);
    observe(controller, 'facing'); advance(controller, 1000, 'facing');
    expect(video.paused).toBe(true);
  });

  it('rejects future, reordered and stale observations without finishing a pending action', () => {
    const { video, controller } = setup();
    observe(controller, 'away'); advance(controller, 900, 'away');
    expect(controller.status().pending).toBe('pause');
    time += 100;
    observe(controller, 'away', -51);
    expect(video.paused).toBe(false);
    observe(controller, 'away', 0, 1);
    expect(video.paused).toBe(false);
    observe(controller, 'away', 351);
    expect(controller.status().pending).toBeNull();
    expect(video.paused).toBe(false);
  });

  it('resumes only its own pause when auto resume is enabled', async () => {
    const { video, controller } = setup();
    observe(controller, 'away'); advance(controller, 1000, 'away');
    observe(controller, 'facing'); advance(controller, 400, 'facing');
    expect(video.paused).toBe(true);
    advance(controller, 100, 'facing');
    await Promise.resolve();
    expect(video.paused).toBe(false);
    expect(controller.status().ownsPause).toBe(false);
    video.pause();
    observe(controller, 'facing'); advance(controller, 1000, 'facing');
    expect(video.paused).toBe(true);
  });

  it('keeps assistant pauses paused with the default auto resume preference', () => {
    const { video, controller } = setup(undefined, { ...settings, autoResume: false });
    observe(controller, 'away'); advance(controller, 1000, 'away');
    observe(controller, 'facing'); advance(controller, 1500, 'facing');
    expect(video.paused).toBe(true);
    expect(controller.status().ownsPause).toBe(true);
  });

  it('clears ownership for explicit pause even while already assistant paused', async () => {
    const { video, controller } = setup();
    observe(controller, 'away'); advance(controller, 1000, 'away');
    await controller.control('pause');
    observe(controller, 'facing'); advance(controller, 1000, 'facing');
    expect(video.paused).toBe(true);
    expect(controller.status().ownsPause).toBe(false);
  });

  it('breaks pending timing on unknown tracking', () => {
    const { video, controller } = setup();
    observe(controller, 'away'); advance(controller, 900, 'away');
    time += 100; observe(controller, 'unknown');
    expect(controller.status().pending).toBeNull();
    observe(controller, 'away'); advance(controller, 900, 'away');
    expect(video.paused).toBe(false);
    advance(controller, 100, 'away'); expect(video.paused).toBe(true);
  });

  it('does not transfer ownership to a replacement video', () => {
    const { page, controller } = setup();
    observe(controller, 'away'); advance(controller, 1000, 'away');
    expect(controller.status().ownsPause).toBe(true);
    const replacement = new Video(); replacement.paused = true;
    page.videos = [replacement];
    observe(controller, 'facing'); advance(controller, 1000, 'facing');
    expect(replacement.paused).toBe(true);
    expect(controller.status().ownsPause).toBe(false);
  });

  it('discovers a video inserted after attachment without controlling an old hidden video', () => {
    const { page, controller } = setup([]);
    expect(controller.status().videoFound).toBe(false);
    const lateVideo = new Video(); page.videos.push(lateVideo);
    observe(controller, 'away'); advance(controller, 1000, 'away');
    expect(lateVideo.paused).toBe(true);
    lateVideo.style.visibility = 'hidden';
    expect(controller.status().videoFound).toBe(false);
    expect(controller.status().ownsPause).toBe(false);
  });

  it.each(['seeking', 'loadstart', 'emptied', 'ended'])('clears ownership on the %s media event', event => {
    const { video, controller } = setup();
    observe(controller, 'away'); advance(controller, 1000, 'away');
    video.dispatchEvent(new Event(event));
    observe(controller, 'facing'); advance(controller, 1000, 'facing');
    expect(video.paused).toBe(true);
    expect(controller.status().ownsPause).toBe(false);
  });

  it('notices a changed source even if the page emits no media event', () => {
    const { video, controller } = setup();
    observe(controller, 'away'); advance(controller, 1000, 'away');
    video.currentSrc = 'https://example.test/next.mp4';
    observe(controller, 'facing'); advance(controller, 1000, 'facing');
    expect(video.paused).toBe(true);
    expect(controller.status().ownsPause).toBe(false);
  });

  it('suspends hidden documents and leaves playback to the user', () => {
    const { page, video, controller } = setup();
    observe(controller, 'away'); advance(controller, 900, 'away');
    expect(controller.status().pending).toBe('pause');
    page.hidden = true; page.dispatchEvent(new Event('visibilitychange'));
    advance(controller, 2000, 'away');
    expect(video.paused).toBe(false);
    expect(controller.status().ownsPause).toBe(false);
    page.hidden = false; page.dispatchEvent(new Event('visibilitychange'));
    observe(controller, 'away'); advance(controller, 900, 'away');
    expect(video.paused).toBe(false);
  });

  it('cancels a pending automatic play when a manual pause wins before its promise resolves', async () => {
    const { video, controller } = setup();
    observe(controller, 'away'); advance(controller, 1000, 'away');
    video.deferredPlay = () => undefined;
    observe(controller, 'facing'); advance(controller, 500, 'facing');
    await controller.control('pause');
    video.deferredPlay!();
    await Promise.resolve();
    expect(video.paused).toBe(true);
    expect(controller.status().ownsPause).toBe(false);
  });

  it('does not undo a later manual play when an older automatic play finishes', async () => {
    const { video, controller } = setup();
    observe(controller, 'away'); advance(controller, 1000, 'away');
    expect(video.paused).toBe(true);
    video.deferredPlay = () => undefined;
    observe(controller, 'facing'); advance(controller, 500, 'facing');
    const finishOldPlay = video.deferredPlay!;
    await controller.control('pause');
    video.deferredPlay = null;
    await controller.control('play');
    finishOldPlay();
    await Promise.resolve();
    expect(video.paused).toBe(false);
  });

  it('resets after a rejected automatic play without retrying or restoring ownership', async () => {
    const { video, controller } = setup();
    observe(controller, 'away'); advance(controller, 1000, 'away');
    video.blockPlay = true;
    observe(controller, 'facing'); advance(controller, 500, 'facing');
    await Promise.resolve(); await Promise.resolve();
    expect(video.paused).toBe(true);
    expect(controller.status().ownsPause).toBe(false);
    expect(controller.status().message).toMatch(/click|play/i);
  });

  it('preserves manual play on a newly attached controller when an old play finishes', async () => {
    const { video, page, controller } = setup();
    observe(controller, 'away'); advance(controller, 1000, 'away');
    video.deferredPlay = () => undefined;
    observe(controller, 'facing'); advance(controller, 500, 'facing');
    const finishOldPlay = video.deferredPlay!;
    controller.destroy();
    const next = new ExtensionVideoController(page as unknown as Document, settings, 'new-token', () => time);
    controllers.push(next);
    video.deferredPlay = null;
    await next.control('play');
    finishOldPlay(); await Promise.resolve();
    expect(video.paused).toBe(false);
    expect(next.status().ownsPause).toBe(false);
  });

  it.each(['same attachment', 'reset', 'new attachment', 'delayed event loop'])('preserves manual play after a queued assistant pause event across %s', async boundary => {
    const { page, video, controller } = setup();
    video.queueEvents = true;
    observe(controller, 'away'); advance(controller, 1000, 'away');
    expect(video.paused).toBe(true);
    if (boundary === 'delayed event loop') time += 2000;
    let current = controller;
    if (boundary === 'reset') current.reset();
    if (boundary === 'new attachment') {
      current.destroy();
      current = new ExtensionVideoController(page as unknown as Document, settings, 'new-token', () => time);
      controllers.push(current);
    }
    const manualPlay = current.control('play');
    video.flushEvents();
    await manualPlay;
    expect(video.paused).toBe(false);
    expect(current.status().ownsPause).toBe(false);
  });

  it('preserves an explicit pending Play when tracking stops', async () => {
    const video = new Video(); video.paused = true;
    const { controller } = setup([video]);
    video.deferredPlay = () => undefined;
    const manualPlay = controller.control('play');
    controller.reset();
    video.deferredPlay!(); await manualPlay;
    expect(video.paused).toBe(false);
  });

  it('preserves a newer attachment pause when an old explicit Play completes', async () => {
    const video = new Video(); video.paused = true;
    const { page, controller } = setup([video]);
    video.deferredPlay = () => undefined;
    const oldPlay = controller.control('play');
    controller.destroy();
    const current = new ExtensionVideoController(page as unknown as Document, settings, 'new-token', () => time);
    controllers.push(current);
    await current.control('pause');
    video.deferredPlay!(); await oldPlay;
    expect(video.paused).toBe(true);
  });

  it('does not revive an older video when a replacement is manually played', async () => {
    const { video, page, controller } = setup();
    observe(controller, 'away'); advance(controller, 1000, 'away');
    video.deferredPlay = () => undefined;
    observe(controller, 'facing'); advance(controller, 500, 'facing');
    const finishOldPlay = video.deferredPlay!;
    const replacement = new Video(); replacement.paused = true;
    page.videos = [replacement];
    await controller.control('play');
    finishOldPlay(); await Promise.resolve();
    expect(video.paused).toBe(true);
    expect(replacement.paused).toBe(false);
  });

  it.each(['expired', 'unknown', 'away', 'hidden'])('rejects a late automatic Play completion after tracking becomes %s', async state => {
    const { page, video, controller } = setup();
    observe(controller, 'away'); advance(controller, 1000, 'away');
    video.deferredPlay = () => undefined;
    observe(controller, 'facing'); advance(controller, 500, 'facing');
    if (state === 'expired') time += 351; // Deliberately do not deliver the watchdog timer.
    else if (state === 'hidden') page.hidden = true;
    else observe(controller, state as 'unknown' | 'away');
    video.deferredPlay!(); await Promise.resolve();
    expect(video.paused).toBe(true);
    expect(controller.status().ownsPause).toBe(false);
  });

  it('clears the signal on reset and refuses control after destruction', async () => {
    const { video, controller } = setup();
    observe(controller, 'away'); advance(controller, 900, 'away');
    controller.reset(); time += 100; vi.advanceTimersByTime(100);
    expect(video.paused).toBe(false);
    controller.destroy();
    observe(controller, 'away'); advance(controller, 2000, 'away');
    await controller.control('pause');
    expect(video.paused).toBe(false);
    expect(controller.status().connected).toBe(false);
  });
});

describe('content runtime boundary', () => {
  type Listener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (status: VideoStatus) => void) => boolean | undefined;
  const cleanups: (() => void)[] = [];
  afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
  function content() {
    const page = new Page(); page.videos = [new Video()];
    const listeners: Listener[] = [];
    const api = { runtime: {
      id: 'test-extension', getURL: (path: string) => `chrome-extension://test-extension/${path}`,
      onMessage: {
        addListener: (listener: Listener) => listeners.push(listener),
        removeListener: (listener: Listener) => { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); },
      },
    } } as unknown as typeof chrome;
    const dispose = installContent(api, page as unknown as Document); cleanups.push(dispose);
    const sender = { id: 'test-extension', url: api.runtime.getURL('background.js') };
    const send = (message: unknown, from: chrome.runtime.MessageSender = sender) => {
      let response: VideoStatus | undefined;
      for (const listener of listeners) listener(message, from, value => { response = value; });
      return response;
    };
    const request = (message: unknown) => new Promise<VideoStatus>(resolve => { listeners[0](message, sender, resolve); });
    return { api, page, listeners, send, request };
  }
  const tokenA = '11111111-1111-4111-a111-111111111111';
  const tokenB = '22222222-2222-4222-a222-222222222222';

  it('rejects other extensions, page senders, channels and mismatched tokens', () => {
    const { send, page } = content();
    const attach = { channel: CHANNEL, type: 'ATTACH', token: tokenA, settings };
    expect(send(attach, { id: 'other-extension' })).toBeUndefined();
    expect(send(attach, { id: 'test-extension', tab: { id: 1 } as chrome.tabs.Tab })).toBeUndefined();
    expect(send({ ...attach, channel: 'page-script' })).toBeUndefined();
    expect(send(attach)).toMatchObject({ connected: true, videoFound: true });
    expect(send({ channel: CHANNEL, type: 'CONTROL', token: tokenB, action: 'pause' })).toBeUndefined();
    expect(page.videos[0].paused).toBe(false);
  });

  it('returns direct video status and resets sequence when a new token attaches', () => {
    const { send } = content();
    send({ channel: CHANNEL, type: 'ATTACH', token: tokenA, settings });
    expect(send({ channel: CHANNEL, type: 'OBSERVE', token: tokenA, observation: { pose: 'away', capturedAt: epochNow(), sequence: 500 } })).toMatchObject({ pending: 'pause' });
    expect(send({ channel: CHANNEL, type: 'ATTACH', token: tokenB, settings })).toMatchObject({ pending: null, ownsPause: false });
    expect(send({ channel: CHANNEL, type: 'OBSERVE', token: tokenA, observation: { pose: 'away', capturedAt: epochNow(), sequence: 501 } })).toBeUndefined();
    expect(send({ channel: CHANNEL, type: 'OBSERVE', token: tokenB, observation: { pose: 'away', capturedAt: epochNow(), sequence: 1 } })).toMatchObject({ pending: 'pause' });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('reinjects idempotently without adding timers or runtime listeners', () => {
    const { api, page, listeners, send } = content();
    send({ channel: CHANNEL, type: 'ATTACH', token: tokenA, settings });
    installContent(api, page as unknown as Document);
    expect(listeners.length).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(send({ channel: CHANNEL, type: 'STATUS', token: tokenA })).toMatchObject({ connected: true });
  });

  it('routes only supported explicit actions and returns their resulting playback state', async () => {
    const { request, send, page } = content();
    send({ channel: CHANNEL, type: 'ATTACH', token: tokenA, settings });
    const command = { channel: CHANNEL, type: 'CONTROL', token: tokenA };
    expect(send({ ...command, action: 'download' })).toBeUndefined();
    expect(await request({ ...command, action: 'pause' })).toMatchObject({ paused: true, ownsPause: false });
    await request({ ...command, action: 'rewind' });
    expect(page.videos[0].currentTime).toBe(10);
    expect(await request({ ...command, action: 'play' })).toMatchObject({ paused: false, ownsPause: false });
    expect(send({ channel: CHANNEL, type: 'OBSERVE', token: tokenA, observation: { pose: 'invalid', capturedAt: epochNow(), sequence: 2 } })).toBeUndefined();
    expect(send({ channel: CHANNEL, type: 'RESET', token: tokenA })).toMatchObject({ pending: null, ownsPause: false });
  });

  it('acknowledges a pending Play immediately so a subsequent Pause can still execute', async () => {
    const { send, page } = content();
    send({ channel: CHANNEL, type: 'ATTACH', token: tokenA, settings });
    const video = page.videos[0];
    video.paused = true;
    video.deferredPlay = () => undefined;
    const command = { channel: CHANNEL, type: 'CONTROL', token: tokenA };
    // The Play promise remains unresolved. A serialized background route must
    // still receive this acknowledgement before it can dispatch the next route.
    expect(send({ ...command, action: 'play' })).toMatchObject({ connected: true, paused: true });
    expect(send({ ...command, action: 'pause' })).toMatchObject({ paused: true, ownsPause: false });
    expect(send({ channel: CHANNEL, type: 'STATUS', token: tokenA })).toMatchObject({ connected: true });
    video.deferredPlay!();
    await Promise.resolve();
    expect(video.paused).toBe(true);
  });
});
