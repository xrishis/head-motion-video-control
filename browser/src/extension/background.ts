import {
  CHANNEL,
  MAX_SIGNAL_AGE_MS,
  epochNow,
  normalizeSettings,
  validObservation,
  type ContentMessage,
  type ExtensionResponse,
  type ExtensionSettings,
  type PanelRequest,
  type TargetSession,
  type VideoStatus,
} from './protocol';

const SESSION_KEY = 'stillpointSession';
const SETTINGS_KEY = 'stillpointSettings';
const CONTROLLER_RESPONSE_TIMEOUT_MS = 2000;
const ACCESS_HELP = 'Stillpoint cannot access this page. Click its toolbar icon on the video tab, or allow access to this site in the panel, then reconnect.';

function webUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

function storedSession(value: unknown): TargetSession | null {
  if (!value || typeof value !== 'object') return null;
  const target = value as Partial<TargetSession>;
  if (typeof target.token !== 'string' || target.token.length < 20 || !Number.isSafeInteger(target.tabId) || target.tabId! < 0 ||
      !Number.isSafeInteger(target.windowId) || target.windowId! < 0 || !webUrl(target.url)) return null;
  return {
    token: target.token, tabId: target.tabId!, windowId: target.windowId!, url: target.url,
    title: typeof target.title === 'string' ? target.title : 'Video tab', connected: target.connected === true,
    message: typeof target.message === 'string' ? target.message : 'Reconnect to this video tab.',
  };
}

function trustedPanel(api: typeof chrome, sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== api.runtime.id || sender.tab !== undefined || !sender.url) return false;
  try {
    const actual = new URL(sender.url);
    const expected = new URL(api.runtime.getURL('panel.html'));
    return actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname;
  } catch { return false; }
}

function isStatus(value: unknown): value is VideoStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Partial<VideoStatus>;
  return typeof status.connected === 'boolean' && typeof status.videoFound === 'boolean' && typeof status.paused === 'boolean' &&
    typeof status.ownsPause === 'boolean' && typeof status.message === 'string' && typeof status.progress === 'number' &&
    Number.isFinite(status.progress) && ['pause', 'resume', null].includes(status.pending ?? null) &&
    ['youtube', 'netflix', 'html5'].includes(status.site ?? '') && Number.isSafeInteger(status.videoCount);
}

/** Install one worker's handlers. All writes and routes share one queue; events can cancel an in-flight attachment immediately. */
export function installBackground(api: typeof chrome): void {
  let session: TargetSession | null = null;
  let settings: ExtensionSettings = normalizeSettings(undefined);
  let queue = Promise.resolve();
  let generation = 0;
  let initializing = true;
  let initializationError = '';
  let attaching: TargetSession | null = null;
  let lastSignal: { token: string; sequence: number; capturedAt: number } | null = null;

  const result = (ok: boolean, extra: Omit<ExtensionResponse, 'ok' | 'session' | 'settings'> = {}): ExtensionResponse => ({ ok, session, settings, ...extra });
  const fail = (error: string) => result(false, { error });
  const save = async (target: TargetSession | null) => {
    session = target;
    await api.storage.session.set({ [SESSION_KEY]: target });
  };
  const send = async (target: TargetSession, message: ContentMessage): Promise<VideoStatus> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const expired = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('The video page is not responding. Reconnect to the video tab.')), CONTROLLER_RESPONSE_TIMEOUT_MS);
      });
      // A suspended/busy content document can leave Chrome's message promise unsettled.
      // Bound RESET too, so recovery never waits forever behind the original request.
      const response: unknown = await Promise.race([api.tabs.sendMessage(target.tabId, message, { frameId: 0 }), expired]);
      if (!isStatus(response)) throw new Error('The page controller did not answer. Reconnect to the video tab.');
      return response;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const reset = async (target: TargetSession) => {
    // A closed/navigated tab has no receiver. Clearing stored state must still succeed.
    try { await send(target, { channel: CHANNEL, type: 'RESET', token: target.token }); } catch { /* receiver may have gone away */ }
    lastSignal = null;
  };
  const disconnect = async (message: string) => {
    if (!session) return;
    const target = session;
    await reset(target);
    await save({ ...target, connected: false, message });
  };

  const ready = (async () => {
    const [savedSession, savedSettings] = await Promise.all([
      api.storage.session.get(SESSION_KEY), api.storage.local.get(SETTINGS_KEY),
    ]);
    settings = normalizeSettings(savedSettings[SETTINGS_KEY]);
    session = storedSession(savedSession[SESSION_KEY]);
    if (session?.connected) {
      const target = session;
      try {
        const tab = await api.tabs.get(target.tabId);
        if (!tab.active || tab.windowId !== target.windowId || tab.url !== target.url) {
          await disconnect('The selected tab changed. Reconnect to the video tab.');
        } else {
          // Never restore assistant pause ownership from before this worker lifetime.
          await send(target, { channel: CHANNEL, type: 'RESET', token: target.token });
        }
      } catch {
        await save({ ...target, connected: false, message: 'The page connection expired. Reconnect to the video tab.' });
      }
    }
  })().catch(() => {
    initializationError = 'Stillpoint could not read its saved session. Reload the extension and reconnect.';
  }).finally(() => { initializing = false; });

  function enqueue(task: () => Promise<ExtensionResponse>): Promise<ExtensionResponse> {
    const response = queue.then(async () => {
      await ready;
      if (initializationError) return fail(initializationError);
      return task();
    }).catch(() => fail('Stillpoint could not finish this request. Reconnect to the video tab and try again.'));
    queue = response.then(() => {});
    return response;
  }

  async function attach(tab: chrome.tabs.Tab, requestedGeneration: number): Promise<ExtensionResponse> {
    if (requestedGeneration !== generation) return fail('The selected tab changed. Connect again when the video tab is active.');
    if (tab.id === undefined || !webUrl(tab.url)) {
      await disconnect('Open an HTTP or HTTPS video page, then click the Stillpoint toolbar icon.');
      return fail('Open an HTTP or HTTPS page with a top-level video, then click the Stillpoint toolbar icon.');
    }
    if (session) await reset(session);
    const target: TargetSession = {
      token: crypto.randomUUID(), tabId: tab.id, windowId: tab.windowId, title: tab.title || new URL(tab.url).hostname,
      url: tab.url, connected: false, message: 'Connecting to the video tab…',
    };
    attaching = target;
    let injected = false;
    const cancelled = async () => {
      if (injected) await reset(target);
      await save({ ...target, connected: false, message: 'The selected tab changed. Reconnect to the active video tab.' });
      return fail('The selected tab changed. Connect again when the video tab is active.');
    };
    try {
      await save(target);
      if (requestedGeneration !== generation) return cancelled();
      // Chrome enforces activeTab or an already granted optional origin here. No permission is requested by the worker.
      await api.scripting.executeScript({ target: { tabId: target.tabId, frameIds: [0] }, files: ['content.js'] });
      injected = true;
      if (requestedGeneration !== generation) return cancelled();
      const status = await send(target, { channel: CHANNEL, type: 'ATTACH', token: target.token, settings });
      if (requestedGeneration !== generation) return cancelled();
      await save({ ...target, connected: status.connected, message: status.message });
      if (requestedGeneration !== generation) return cancelled();
      return result(true, { status });
    } catch {
      // A content handler may have received ATTACH even when its response channel failed.
      if (injected) await reset(target);
      await save({ ...target, connected: false, message: ACCESS_HELP });
      return fail(ACCESS_HELP);
    } finally {
      attaching = null;
    }
  }

  async function forward(message: ContentMessage): Promise<ExtensionResponse> {
    const target = session;
    if (!target?.connected) return fail(target?.message || 'Connect to a video tab first.');
    try {
      const status = await send(target, message);
      return result(true, { status });
    } catch {
      await disconnect('The page connection expired. Reconnect to the video tab.');
      return fail('The page connection expired. Reconnect to the video tab.');
    }
  }

  async function handle(request: PanelRequest, sender: chrome.runtime.MessageSender, requestedGeneration: number): Promise<ExtensionResponse> {
    switch (request.type) {
      case 'GET_SESSION': return result(true);
      case 'CONNECT_ACTIVE': {
        let windowId: number | undefined;
        if (sender.documentId && typeof api.runtime.getContexts === 'function') {
          try {
            const contexts = await api.runtime.getContexts({ contextTypes: ['SIDE_PANEL'], documentIds: [sender.documentId] });
            const panel = contexts.find((context) => context.documentId === sender.documentId && context.contextType === 'SIDE_PANEL' && context.windowId >= 0);
            windowId = panel?.windowId;
          } catch { /* browsers without document context lookup use the current window */ }
        }
        const tabs = await api.tabs.query(windowId === undefined ? { active: true, currentWindow: true } : { active: true, windowId });
        if (!tabs[0]) return fail('Open and select a video tab, then click the Stillpoint toolbar icon.');
        return attach(tabs[0], requestedGeneration);
      }
      case 'GET_STATUS':
        return session ? forward({ channel: CHANNEL, type: 'STATUS', token: session.token }) : result(true, { status: null });
      case 'STOP':
        if (session?.connected) {
          const response = await forward({ channel: CHANNEL, type: 'RESET', token: session.token });
          lastSignal = null;
          return response;
        }
        lastSignal = null;
        return result(true);
      case 'SETTINGS': {
        settings = normalizeSettings(request.settings);
        await api.storage.local.set({ [SETTINGS_KEY]: settings });
        if (session?.connected) return forward({ channel: CHANNEL, type: 'CONFIGURE', token: session.token, settings });
        return result(true);
      }
      case 'POSE': {
        if (requestedGeneration !== generation || !session?.connected || request.token !== session.token) return fail('This tracking session has expired. Reconnect to the video tab.');
        if (!validObservation(request.observation)) return fail('The tracking observation was invalid.');
        const { capturedAt, sequence } = request.observation;
        const age = epochNow() - capturedAt;
        if (age < 0 || age > MAX_SIGNAL_AGE_MS || (lastSignal?.token === session.token && (sequence <= lastSignal.sequence || capturedAt < lastSignal.capturedAt))) {
          return fail('The tracking observation was stale or out of order.');
        }
        lastSignal = { token: session.token, sequence, capturedAt };
        return forward({ channel: CHANNEL, type: 'OBSERVE', token: session.token, observation: request.observation });
      }
      case 'TARGET_ACTION':
        if (requestedGeneration !== generation || !session?.connected || request.token !== session.token) return fail('This video session has expired. Reconnect to the video tab.');
        if (!['play', 'pause', 'rewind'].includes(request.action)) return fail('That video action is not supported.');
        lastSignal = null;
        return forward({ channel: CHANNEL, type: 'CONTROL', token: session.token, action: request.action });
      default: return fail('That Stillpoint request is not supported.');
    }
  }

  api.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!trustedPanel(api, sender) || !message || typeof message !== 'object' || (message as Partial<PanelRequest>).channel !== CHANNEL) return false;
    const request = message as PanelRequest;
    const requestedGeneration = request.type === 'CONNECT_ACTIVE' || request.type === 'STOP' ? ++generation : generation;
    void enqueue(() => handle(request, sender, requestedGeneration)).then((response) => {
      try { sendResponse(response); } catch { /* panel closed before its response arrived */ }
    });
    return true;
  });

  api.runtime.onConnect.addListener((port) => {
    if (port.name !== 'stillpoint-panel' || !port.sender || !trustedPanel(api, port.sender)) return;
    port.onDisconnect.addListener(() => {
      ++generation;
      void enqueue(async () => {
        if (session?.connected) await reset(session);
        return result(true);
      });
    });
  });

  api.action.onClicked.addListener((tab) => {
    // This call must occur in the toolbar's user gesture, before any storage or injection awaits.
    try { void api.sidePanel.open({ windowId: tab.windowId }).catch(() => {}); } catch { /* unsupported browser */ }
    const requestedGeneration = ++generation;
    void enqueue(() => attach(tab, requestedGeneration));
  });
  try { void api.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {}); } catch { /* older unsupported browser */ }

  function invalidate(matches: (target: TargetSession) => boolean, message: string) {
    if (initializing || (session && matches(session)) || (attaching && matches(attaching))) ++generation;
    void enqueue(async () => {
      if (session && matches(session)) await disconnect(message);
      return result(true);
    });
  }

  api.tabs.onActivated.addListener(({ tabId, windowId }) => {
    invalidate((target) => target.windowId === windowId && target.tabId !== tabId, 'The active tab changed. Reconnect to your video tab to continue.');
  });
  api.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== 'loading' && change.url === undefined) return;
    invalidate((target) => target.tabId === tabId && (change.status === 'loading' || change.url !== target.url), 'The video page navigated. Reconnect to continue.');
  });
  api.tabs.onRemoved.addListener((tabId) => {
    invalidate((target) => target.tabId === tabId, 'The video tab was closed. Select another video tab and connect.');
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id) installBackground(chrome);
