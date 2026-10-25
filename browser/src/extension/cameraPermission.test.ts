import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCameraPermission, requestCameraPermission } from './cameraPermission';

type Listener = (...args: any[]) => any;
function event() {
  const listeners = new Set<Listener>();
  return { addListener: (listener: Listener) => listeners.add(listener), removeListener: (listener: Listener) => listeners.delete(listener), emit: (...args: unknown[]) => [...listeners].map((listener) => listener(...args)), size: () => listeners.size };
}

function fixture(create?: Promise<{ id: number }>) {
  const messages = event();
  const removed = event();
  const effects: string[] = [];
  const creations: chrome.windows.CreateData[] = [];
  const api = {
    runtime: { id: 'stillpoint-test', getURL: (path: string) => `chrome-extension://stillpoint-test/${path}`, onMessage: messages },
    windows: {
      onRemoved: removed,
      create: (options: chrome.windows.CreateData) => { effects.push('create'); creations.push(options); return create ?? Promise.resolve({ id: 12 }); },
      remove: async (id: number) => { effects.push(`close:${id}`); },
      update: async (id: number, update: chrome.windows.UpdateInfo) => { if (update.focused) effects.push(`focus:${id}`); },
    },
  } as unknown as typeof chrome;
  const signal = new AbortController();
  const request = () => requestCameraPermission({ signal: signal.signal, parentWindowId: 8 }, api);
  const granted = (overrides: Record<string, unknown> = {}, senderOverrides: Record<string, unknown> = {}) => {
    const url = creations[0].url as string;
    const requestId = new URL(url).searchParams.get('request');
    let acknowledgement: unknown;
    messages.emit({ channel: 'stillpoint-camera-permission-v1', type: 'granted', requestId, ...overrides }, { id: 'stillpoint-test', url, ...senderOverrides }, (response: unknown) => { acknowledgement = response; });
    return acknowledgement;
  };
  return { messages, removed, effects, creations, api, signal, request, granted };
}

afterEach(() => vi.unstubAllGlobals());

describe('camera permission state', () => {
  it.each(['granted', 'prompt', 'denied'] as const)('reports the browser’s %s state without asking for a camera', async (state) => {
    const queried: unknown[] = [];
    vi.stubGlobal('navigator', { permissions: { query: async (descriptor: unknown) => { queried.push(descriptor); return { state }; } } });
    expect(await readCameraPermission()).toBe(state);
    expect(queried).toEqual([{ name: 'camera' }]);
  });

  it('handles unavailable and unsupported permission queries', async () => {
    vi.stubGlobal('navigator', {});
    expect(await readCameraPermission()).toBeNull();
    vi.stubGlobal('navigator', { permissions: { query: async () => { throw new TypeError('Unsupported permission'); } } });
    expect(await readCameraPermission()).toBeNull();
  });
});

describe('camera permission popup handshake', () => {
  it('listens before opening and resolves a validated grant after closing the popup and focusing its parent', async () => {
    const popup = fixture();
    const pending = popup.request();
    expect(popup.messages.size()).toBe(1);
    expect(popup.removed.size()).toBe(1);
    expect(popup.creations[0]).toMatchObject({ type: 'popup', focused: true });
    const url = new URL(popup.creations[0].url as string);
    expect(url.pathname).toBe('/camera-permission.html');
    expect(url.searchParams.get('request')?.length).toBeGreaterThan(20);
    expect(popup.granted()).toEqual({ ok: true });
    await pending;
    expect(popup.effects).toEqual(['create', 'close:12', 'focus:8']);
    expect(popup.messages.size()).toBe(0);
    expect(popup.removed.size()).toBe(0);
    popup.signal.abort();
    expect(popup.effects).toEqual(['create', 'close:12', 'focus:8']);
  });

  it('ignores spoofed senders, paths, channels and request ids until the matching popup grants access', async () => {
    const popup = fixture();
    let finished = false;
    const pending = popup.request().then(() => { finished = true; });
    const wrongMessages = [
      [{ channel: 'other' }, {}], [{ type: 'denied' }, {}], [{ requestId: 'another-request' }, {}],
      [{}, { id: 'another-extension' }], [{}, { url: 'https://stillpoint-test/camera-permission.html' }],
      [{}, { url: 'chrome-extension://stillpoint-test/panel.html' }],
      [{}, { url: 'chrome-extension://stillpoint-test/camera-permission.html?request=another-request' }],
    ];
    for (const [message, sender] of wrongMessages) expect(popup.granted(message, sender)).toBeUndefined();
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(popup.effects).toEqual(['create']);
    popup.granted();
    await pending;
  });

  it('rejects cancellation immediately and closes a popup whose creation completes after cancellation', async () => {
    let created!: (window: { id: number }) => void;
    const popup = fixture(new Promise((resolve) => { created = resolve; }));
    const pending = popup.request();
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    popup.signal.abort();
    await rejection;
    expect(popup.messages.size()).toBe(0);
    expect(popup.removed.size()).toBe(0);
    created({ id: 12 });
    await Promise.resolve();
    await Promise.resolve();
    expect(popup.effects).toEqual(['create', 'close:12']);
  });

  it('does not open a popup when its request was already cancelled', async () => {
    const popup = fixture();
    popup.signal.abort();
    await expect(popup.request()).rejects.toMatchObject({ name: 'AbortError' });
    expect(popup.creations).toEqual([]);
    expect(popup.messages.size()).toBe(0);
    expect(popup.removed.size()).toBe(0);
  });

  it('rejects a closed popup and removes its listeners', async () => {
    const popup = fixture();
    const pending = popup.request();
    await Promise.resolve();
    popup.removed.emit(12);
    await expect(pending).rejects.toThrow(/closed|cancel/i);
    expect(popup.messages.size()).toBe(0);
    expect(popup.removed.size()).toBe(0);
    expect(popup.effects).not.toContain('focus:8');
  });

  it('recognizes a popup closed before its create promise returns', async () => {
    let created!: (window: { id: number }) => void;
    const popup = fixture(new Promise((resolve) => { created = resolve; }));
    const pending = popup.request();
    popup.removed.emit(12);
    created({ id: 12 });
    await expect(pending).rejects.toThrow(/closed|cancel/i);
    expect(popup.messages.size()).toBe(0);
    expect(popup.removed.size()).toBe(0);
  });

  it('reports creation failure and removes its listeners', async () => {
    const popup = fixture(Promise.reject(new Error('No window available')));
    await expect(popup.request()).rejects.toThrow(/open|permission|window/i);
    expect(popup.messages.size()).toBe(0);
    expect(popup.removed.size()).toBe(0);
    expect(popup.effects).toEqual(['create']);
  });
});
