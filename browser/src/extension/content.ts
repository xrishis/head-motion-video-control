import { CHANNEL, normalizeSettings, validObservation } from './protocol';
import type { VideoAction } from './protocol';
import { ExtensionVideoController } from './videoController';

type ContentGlobal = typeof globalThis & { __stillpointExtensionContentV1?: { dispose: () => void } };
interface Envelope {
  channel?: unknown;
  type?: unknown;
  token?: unknown;
  settings?: unknown;
  observation?: unknown;
  action?: unknown;
}

/** Installed in Chrome's isolated world; reinjection reuses one listener. */
export function installContent(api: typeof chrome, document: Document): () => void {
  const scope = globalThis as ContentGlobal;
  if (scope.__stillpointExtensionContentV1) return scope.__stillpointExtensionContentV1.dispose;
  const view = document.defaultView;
  if (view && view.top !== view.self) return () => {};
  let controller: ExtensionVideoController | null = null;
  let token: string | null = null;

  const listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void): boolean => {
    if (sender.id !== api.runtime.id || sender.tab !== undefined ||
      (sender.url !== undefined && !sender.url.startsWith(api.runtime.getURL(''))) ||
      !message || typeof message !== 'object') return false;
    const request = message as Envelope;
    if (request.channel !== CHANNEL || typeof request.token !== 'string' || request.token.length < 20 || request.token.length > 128 || /\s/.test(request.token)) return false;
    if (request.type === 'ATTACH') {
      if (!controller || token !== request.token) {
        controller?.destroy();
        token = request.token;
        controller = new ExtensionVideoController(document, normalizeSettings(request.settings), token);
      }
      sendResponse(controller.status());
      return false;
    }
    if (!controller || request.token !== token) return false;
    switch (request.type) {
      case 'OBSERVE':
        if (!validObservation(request.observation)) return false;
        controller.observe(request.observation);
        break;
      case 'CONFIGURE': controller.configure(normalizeSettings(request.settings)); break;
      case 'CONTROL': {
        if (typeof request.action !== 'string' || !['play', 'pause', 'rewind'].includes(request.action)) return false;
        const active = controller;
        // Loading media can leave play() pending indefinitely. Acknowledge the
        // command now so the router remains free to deliver Pause/Stop/status.
        void active.control(request.action as VideoAction).catch(() => active.reset());
        break;
      }
      case 'RESET': controller.reset(); break;
      case 'STATUS': break;
      default: return false;
    }
    sendResponse(controller.status());
    return false;
  };
  api.runtime.onMessage.addListener(listener);
  const dispose = () => {
    controller?.destroy();
    controller = null;
    token = null;
    api.runtime.onMessage.removeListener(listener);
    delete scope.__stillpointExtensionContentV1;
  };
  scope.__stillpointExtensionContentV1 = { dispose };
  return dispose;
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof document !== 'undefined') installContent(chrome, document);
