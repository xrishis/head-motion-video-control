import { describe, expect, it, vi } from 'vitest';
import { installBackground } from './background';
import { CHANNEL, epochNow, type ContentMessage, type ExtensionResponse, type VideoStatus } from './protocol';

type Listener = (...args: any[]) => any;
function event() {
  const listeners: Listener[] = [];
  return { addListener: (listener: Listener) => listeners.push(listener), emit: (...args: unknown[]) => listeners.map((listener) => listener(...args)) };
}

function browserFixture(initialSession?: unknown) {
  const clicked = event();
  const messages = event();
  const connected = event();
  const activated = event();
  const updated = event();
  const removed = event();
  const local: Record<string, unknown> = { stillpointSettings: { pauseDelayMs: 99999, autoResume: true, sensitivity: 'sensitive' } };
  const session: Record<string, unknown> = { stillpointSession: initialSession };
  const tab = { id: 42, windowId: 8, index: 0, active: true, url: 'https://video.example/watch', title: 'Lesson', pinned: false, highlighted: true, incognito: false, selected: true, discarded: false, autoDiscardable: true, groupId: -1 };
  const routed: { tabId: number; message: ContentMessage; options: unknown }[] = [];
  const effects: string[] = [];
  const queries: chrome.tabs.QueryInfo[] = [];
  let injectionError: Error | undefined;
  let injectionGate: Promise<void> | undefined;
  let attachmentGate: Promise<void> | undefined;
  let statusGate: Promise<void> | undefined;
  let attachmentError = false;
  let contentUnavailable = false;
  const hungMessages = new Set<ContentMessage['type']>();
  const status: VideoStatus = { connected: true, videoFound: true, paused: false, ownsPause: false, pending: null, progress: 0, message: 'Video ready', site: 'html5', videoCount: 1 };
  const area = (values: Record<string, unknown>) => ({
    get: async (key: string) => ({ [key]: values[key] }),
    set: async (items: Record<string, unknown>) => { Object.assign(values, items); },
  });
  const api = {
    runtime: {
      id: 'extension-id', getURL: (path: string) => `chrome-extension://extension-id/${path}`, onMessage: messages, onConnect: connected,
      getContexts: async () => [{ contextId: 'panel-context', contextType: 'SIDE_PANEL', documentId: 'panel-document', documentUrl: 'chrome-extension://extension-id/panel.html', documentOrigin: 'chrome-extension://extension-id', windowId: 8, tabId: -1, frameId: 0, incognito: false }],
    },
    storage: { local: area(local), session: area(session) },
    action: { onClicked: clicked },
    sidePanel: { open: () => { effects.push('open'); return new Promise<void>(() => {}); }, setPanelBehavior: async () => {} },
    tabs: {
      get: async () => ({ ...tab }), query: async (query: chrome.tabs.QueryInfo) => { queries.push(query); return [{ ...tab }]; }, onActivated: activated, onUpdated: updated, onRemoved: removed,
      sendMessage: async (tabId: number, message: ContentMessage, options: unknown) => {
        if (contentUnavailable) throw new Error('Receiving end does not exist');
        routed.push({ tabId, message, options });
        if (hungMessages.has(message.type)) await new Promise<never>(() => {});
        if (message.type === 'ATTACH') await attachmentGate;
        if (message.type === 'STATUS') await statusGate;
        if (message.type === 'ATTACH' && attachmentError) throw new Error('The message channel closed');
        return { ...status };
      },
    },
    scripting: { executeScript: async () => { effects.push('inject'); await injectionGate; if (injectionError) throw injectionError; return [{ frameId: 0, result: undefined }]; } },
  } as unknown as typeof chrome;
  const panelSender = { id: 'extension-id', url: 'chrome-extension://extension-id/panel.html' };
  const request = (message: unknown, sender: chrome.runtime.MessageSender = panelSender): Promise<ExtensionResponse> => new Promise((resolve, reject) => {
    const pending = messages.emit(message, sender, resolve);
    if (!pending.some((value) => value === true)) reject(new Error('Message was not accepted'));
  });
  installBackground(api);
  return {
    clicked, messages, connected, activated, updated, removed, local, session, tab, routed, effects, queries, panelSender, request,
    denyInjection: () => { injectionError = new Error('Cannot access contents of the page'); },
    holdInjection: (gate: Promise<void>) => { injectionGate = gate; },
    holdAttachment: (gate: Promise<void>) => { attachmentGate = gate; },
    holdStatus: (gate: Promise<void>) => { statusGate = gate; },
    failAttachment: () => { attachmentError = true; },
    removeContent: () => { contentUnavailable = true; },
    hangMessages: (...types: ContentMessage['type'][]) => { types.forEach((type) => hungMessages.add(type)); },
    resumeMessages: () => { hungMessages.clear(); },
  };
}

describe('extension background trust and target routing', () => {
  it('opens the panel synchronously and attaches using normalized settings in frame zero', async () => {
    const browser = browserFixture();
    browser.clicked.emit(browser.tab);
    expect(browser.effects).toEqual(['open']);
    const result = await browser.request({ channel: CHANNEL, type: 'GET_SESSION' });
    expect(result.ok).toBe(true);
    expect(result.session).toMatchObject({ tabId: 42, windowId: 8, connected: true, url: 'https://video.example/watch' });
    expect(result.session?.token.length).toBeGreaterThan(20);
    expect(result.settings).toEqual({ pauseDelayMs: 5000, returnDelayMs: 1000, autoResume: true, sensitivity: 'sensitive' });
    expect(browser.routed.at(-1)).toMatchObject({ tabId: 42, options: { frameId: 0 }, message: { type: 'ATTACH', token: result.session?.token, settings: result.settings } });
    expect(browser.session.stillpointSession).toEqual(result.session);
  });

  it('accepts only packaged panel senders without a sender tab', async () => {
    const browser = browserFixture();
    for (const sender of [
      { id: 'different-extension', url: browser.panelSender.url },
      { id: 'extension-id', url: 'https://video.example/panel.html' },
      { id: 'extension-id', url: 'chrome-extension://extension-id/content.js' },
      { ...browser.panelSender, tab: browser.tab },
    ]) {
      expect(browser.messages.emit({ channel: CHANNEL, type: 'CONNECT_ACTIVE' }, sender, () => {})).not.toContain(true);
    }
    expect(browser.effects).toEqual([]);
    expect((await browser.request({ channel: CHANNEL, type: 'GET_SESSION' }, { ...browser.panelSender, url: `${browser.panelSender.url}?setup=1` })).ok).toBe(true);
  });

  it('reports permission denial without attaching a session or sending content commands', async () => {
    const browser = browserFixture();
    browser.denyInjection();
    const result = await browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/toolbar|access|allow/i);
    expect(result.session?.connected).not.toBe(true);
    expect(browser.routed).toEqual([]);
  });

  it('rejects restricted pages before attempting injection', async () => {
    const browser = browserFixture();
    browser.tab.url = 'chrome://extensions';
    const result = await browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HTTP|HTTPS|page/i);
    expect(browser.effects).toEqual([]);
  });

  it('rejects spoofed, stale, future, malformed and reordered observations before forwarding', async () => {
    const browser = browserFixture();
    const connected = await browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' });
    const token = connected.session!.token;
    const send = (tokenValue: string, observation: unknown) => browser.request({ channel: CHANNEL, type: 'POSE', token: tokenValue, observation });
    const capturedAt = epochNow();
    for (const [tokenValue, observation] of [
      ['wrong-session', { pose: 'away', capturedAt, sequence: 0 }],
      [token, { pose: 'away', capturedAt: capturedAt - 1000, sequence: 0 }],
      [token, { pose: 'away', capturedAt: capturedAt + 1000, sequence: 0 }],
      [token, { pose: 'other', capturedAt, sequence: 0 }],
    ] as const) expect((await send(tokenValue, observation)).ok).toBe(false);
    expect((await send(token, { pose: 'away', capturedAt, sequence: 3 })).ok).toBe(true);
    expect((await send(token, { pose: 'facing', capturedAt, sequence: 2 })).ok).toBe(false);
    expect((await send(token, { pose: 'facing', capturedAt: capturedAt - 1, sequence: 4 })).ok).toBe(false);
    expect(browser.routed.filter(({ message }) => message.type === 'OBSERVE')).toHaveLength(1);
  });

  it('normalizes updates, validates explicit actions and keeps the selected session after Stop', async () => {
    const browser = browserFixture();
    const connected = await browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' });
    const token = connected.session!.token;
    const configured = await browser.request({ channel: CHANNEL, type: 'SETTINGS', settings: { pauseDelayMs: -5, returnDelayMs: Infinity, autoResume: 'yes', sensitivity: 'invalid' } });
    expect(configured.settings).toEqual({ pauseDelayMs: 1000, returnDelayMs: 1000, autoResume: false, sensitivity: 'balanced' });
    expect(browser.local.stillpointSettings).toEqual(configured.settings);
    expect((await browser.request({ channel: CHANNEL, type: 'TARGET_ACTION', token: 'wrong', action: 'play', tabId: 99 })).ok).toBe(false);
    expect((await browser.request({ channel: CHANNEL, type: 'TARGET_ACTION', token, action: 'arbitrary' })).ok).toBe(false);
    expect((await browser.request({ channel: CHANNEL, type: 'TARGET_ACTION', token, action: 'rewind', tabId: 99 })).ok).toBe(true);
    expect(browser.routed.at(-1)).toMatchObject({ tabId: 42, message: { type: 'CONTROL', action: 'rewind' } });
    const stopped = await browser.request({ channel: CHANNEL, type: 'STOP' });
    expect(browser.routed.at(-1)?.message.type).toBe('RESET');
    expect(stopped.session).toMatchObject({ token, connected: true });
  });

  it('invalidates on target-window switches and navigation, but ignores title updates and other windows', async () => {
    const browser = browserFixture();
    await browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' });
    browser.updated.emit(42, { title: 'New lesson title' }, browser.tab);
    browser.activated.emit({ tabId: 99, windowId: 9 });
    expect((await browser.request({ channel: CHANNEL, type: 'GET_SESSION' })).session?.connected).toBe(true);
    browser.activated.emit({ tabId: 99, windowId: 8 });
    expect((await browser.request({ channel: CHANNEL, type: 'GET_SESSION' })).session?.connected).toBe(false);
    expect(browser.routed.at(-1)?.message.type).toBe('RESET');
    await browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' });
    browser.updated.emit(42, { status: 'loading' }, browser.tab);
    expect((await browser.request({ channel: CHANNEL, type: 'GET_SESSION' })).session?.connected).toBe(false);
  });

  it('does not save an attachment that finishes after the learner switches tabs', async () => {
    const browser = browserFixture();
    let release!: () => void;
    browser.holdInjection(new Promise<void>((resolve) => { release = resolve; }));
    const pending = browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(browser.effects).toContain('inject');
    browser.activated.emit({ tabId: 99, windowId: 8 });
    release();
    expect((await pending).ok).toBe(false);
    expect((await browser.request({ channel: CHANNEL, type: 'GET_SESSION' })).session?.connected).not.toBe(true);
    expect(browser.routed.some(({ message }) => message.type === 'ATTACH')).toBe(false);
  });

  it('clears content ownership before serving a restored worker session', async () => {
    const browser = browserFixture({ token: 'saved-session-token-123456', tabId: 42, windowId: 8, title: 'Lesson', url: 'https://video.example/watch', connected: true, message: 'Connected' });
    const result = await browser.request({ channel: CHANNEL, type: 'GET_SESSION' });
    expect(result.session?.connected).toBe(true);
    expect(browser.routed[0]).toMatchObject({ tabId: 42, message: { type: 'RESET', token: 'saved-session-token-123456' } });
    browser.removeContent();
    const unavailable = await browser.request({ channel: CHANNEL, type: 'GET_STATUS' });
    expect(unavailable.ok).toBe(false);
    expect(unavailable.session?.connected).toBe(false);
    expect(browser.session.stillpointSession).toMatchObject({ connected: false });
  });

  it('resets ownership when the trusted side panel disconnects and keeps the selected tab available', async () => {
    const browser = browserFixture();
    const disconnected = event();
    browser.connected.emit({ name: 'stillpoint-panel', sender: browser.panelSender, onDisconnect: disconnected });
    const connected = await browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' });
    disconnected.emit();
    const result = await browser.request({ channel: CHANNEL, type: 'GET_SESSION' });
    expect(browser.routed.at(-1)).toMatchObject({ message: { type: 'RESET', token: connected.session?.token } });
    expect(result.session).toMatchObject({ token: connected.session?.token, connected: true });
  });

  it('resets a controller that finishes attachment after navigation and never stores it connected', async () => {
    const browser = browserFixture();
    let release!: () => void;
    browser.holdAttachment(new Promise<void>((resolve) => { release = resolve; }));
    const pending = browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(browser.routed.at(-1)?.message.type).toBe('ATTACH');
    browser.updated.emit(42, { status: 'loading' }, browser.tab);
    release();
    expect((await pending).ok).toBe(false);
    expect((await browser.request({ channel: CHANNEL, type: 'GET_SESSION' })).session?.connected).toBe(false);
    expect(browser.routed.at(-1)?.message.type).toBe('RESET');
  });

  it('clears a partially attached controller when its response channel fails', async () => {
    const browser = browserFixture();
    browser.failAttachment();
    const result = await browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' });
    expect(result.ok).toBe(false);
    expect(result.session?.connected).toBe(false);
    expect(browser.routed.map(({ message }) => message.type)).toEqual(['ATTACH', 'RESET']);
  });

  it('selects the active tab in the requesting side panel’s window when Chrome provides its document context', async () => {
    const browser = browserFixture();
    expect((await browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' }, { ...browser.panelSender, documentId: 'panel-document' })).ok).toBe(true);
    expect(browser.queries).toEqual([{ active: true, windowId: 8 }]);
  });

  it('drops queued tracking and explicit controls immediately when a tab switch cancels their generation', async () => {
    const browser = browserFixture();
    const connected = await browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' });
    const token = connected.session!.token;
    let release!: () => void;
    browser.holdStatus(new Promise<void>((resolve) => { release = resolve; }));
    const pendingStatus = browser.request({ channel: CHANNEL, type: 'GET_STATUS' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pendingPose = browser.request({ channel: CHANNEL, type: 'POSE', token, observation: { pose: 'away', capturedAt: epochNow(), sequence: 0 } });
    const pendingControl = browser.request({ channel: CHANNEL, type: 'TARGET_ACTION', token, action: 'play' });
    browser.activated.emit({ tabId: 99, windowId: 8 });
    release();
    await pendingStatus;
    expect((await pendingPose).ok).toBe(false);
    expect((await pendingControl).ok).toBe(false);
    expect(browser.routed.some(({ message }) => message.type === 'OBSERVE' || message.type === 'CONTROL')).toBe(false);
  });

  it('bounds a silent controller and reset so queued Stop, session reads and reconnect can finish', async () => {
    vi.useFakeTimers();
    try {
      const browser = browserFixture();
      const connected = await browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' });
      browser.hangMessages('CONTROL', 'RESET');
      let actionResult: ExtensionResponse | undefined;
      let stopResult: ExtensionResponse | undefined;
      let sessionResult: ExtensionResponse | undefined;
      void browser.request({ channel: CHANNEL, type: 'TARGET_ACTION', token: connected.session!.token, action: 'play' }).then((response) => { actionResult = response; });
      await vi.advanceTimersByTimeAsync(0);
      expect(browser.routed.at(-1)?.message.type).toBe('CONTROL');
      void browser.request({ channel: CHANNEL, type: 'STOP' }).then((response) => { stopResult = response; });
      void browser.request({ channel: CHANNEL, type: 'GET_SESSION' }).then((response) => { sessionResult = response; });
      await vi.advanceTimersByTimeAsync(1999);
      expect(actionResult).toBeUndefined();
      await vi.advanceTimersByTimeAsync(2001);
      expect(actionResult).toMatchObject({ ok: false, session: { connected: false }, error: expect.stringMatching(/reconnect/i) });
      expect(stopResult).toMatchObject({ ok: true, session: { connected: false } });
      expect(sessionResult).toMatchObject({ ok: true, session: { connected: false } });
      expect(vi.getTimerCount()).toBe(0);
      browser.resumeMessages();
      expect((await browser.request({ channel: CHANNEL, type: 'CONNECT_ACTIVE' })).session?.connected).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
