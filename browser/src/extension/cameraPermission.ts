const CAMERA_PERMISSION_CHANNEL = 'stillpoint-camera-permission-v1';

/** Read-only: querying this permission never starts a camera or opens a prompt. */
export async function readCameraPermission(): Promise<PermissionState | null> {
  try {
    if (!globalThis.navigator?.permissions?.query) return null;
    const permission = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return ['granted', 'prompt', 'denied'].includes(permission.state) ? permission.state : null;
  } catch { return null; }
}

export interface CameraPermissionRequestOptions { signal: AbortSignal; parentWindowId: number }

/** Obtain extension-origin camera consent in a visible, focused top-level window. */
export function requestCameraPermission({ signal, parentWindowId }: CameraPermissionRequestOptions, api: typeof chrome = chrome): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const popupUrl = new URL(api.runtime.getURL('camera-permission.html'));
    popupUrl.searchParams.set('request', requestId);
    let windowId: number | undefined;
    let created = false;
    let granted = false;
    let finishing = false;
    let settled = false;
    let closing: Promise<void> | undefined;
    const closedBeforeCreation = new Set<number>();

    const closePopup = (): Promise<void> => {
      if (windowId === undefined) return Promise.resolve();
      if (!closing) {
        try { closing = Promise.resolve(api.windows.remove(windowId)).catch(() => {}); }
        catch { closing = Promise.resolve(); }
      }
      return closing;
    };
    const cleanup = () => {
      api.runtime.onMessage.removeListener(onMessage);
      api.windows.onRemoved.removeListener(onRemoved);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      void closePopup();
      reject(error);
    };
    const finishGrant = async () => {
      if (!granted || !created || finishing || settled) return;
      finishing = true;
      await closePopup();
      if (settled) return;
      try {
        await api.windows.update(parentWindowId, { focused: true });
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      } catch {
        fail(new Error('Camera access was allowed, but Stillpoint could not return to your video window. Reopen the video window and enable the camera again.'));
      }
    };
    function onAbort() {
      fail(new DOMException('Camera permission request was cancelled', 'AbortError'));
    }
    function onRemoved(removedId: number) {
      if (windowId === undefined) closedBeforeCreation.add(removedId);
      else if (removedId === windowId && !finishing) fail(new Error('Camera permission window was closed. Enable the camera again when you are ready.'));
    }
    function onMessage(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void): boolean {
      if (settled || !message || typeof message !== 'object' || sender.id !== api.runtime.id || !sender.url) return false;
      const response = message as { channel?: unknown; type?: unknown; requestId?: unknown };
      if (response.channel !== CAMERA_PERMISSION_CHANNEL || response.type !== 'granted' || response.requestId !== requestId) return false;
      try {
        const actual = new URL(sender.url);
        if (actual.protocol !== popupUrl.protocol || actual.host !== popupUrl.host || actual.pathname !== popupUrl.pathname || actual.searchParams.get('request') !== requestId) return false;
      } catch { return false; }
      granted = true;
      try { sendResponse({ ok: true }); } catch { /* the popup may already be closing */ }
      void finishGrant();
      return false;
    }

    // Register before creation: a fast permission result can arrive before create() resolves.
    api.runtime.onMessage.addListener(onMessage);
    api.windows.onRemoved.addListener(onRemoved);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    try {
      void api.windows.create({ url: popupUrl.href, type: 'popup', focused: true, width: 520, height: 620 }).then((popup) => {
        if (popup?.id === undefined) {
          fail(new Error('Stillpoint could not open the camera permission window. Enable the camera again to retry.'));
          return;
        }
        windowId = popup.id;
        created = true;
        // Abort may have rejected the request while Chrome was still creating its window.
        if (settled) { void closePopup(); return; }
        if (closedBeforeCreation.has(windowId)) {
          fail(new Error('Camera permission window was closed. Enable the camera again when you are ready.'));
          return;
        }
        void finishGrant();
      }, () => fail(new Error('Stillpoint could not open the camera permission window. Enable the camera again to retry.')));
    } catch {
      fail(new Error('Stillpoint could not open the camera permission window. Enable the camera again to retry.'));
    }
  });
}
