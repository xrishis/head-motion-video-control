import './cameraPermissionPage.css';

const CHANNEL = 'stillpoint-camera-permission-v1';
const requestId = new URL(location.href).searchParams.get('request');
const title = document.getElementById('permission-title')!;
const description = document.getElementById('permission-description')!;
const status = document.getElementById('permission-status')!;
const card = document.querySelector<HTMLElement>('.permission-card')!;
const retry = document.getElementById('permission-retry') as HTMLButtonElement;
const settings = document.getElementById('permission-settings') as HTMLButtonElement;
const close = document.getElementById('permission-close') as HTMLButtonElement;
let closed = false;
let busy = false;
let attempt = 0;
let temporaryStream: MediaStream | null = null;

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function dispose(): void {
  closed = true;
  ++attempt;
  stopStream(temporaryStream);
  temporaryStream = null;
}

async function permissionState(): Promise<PermissionState | null> {
  try {
    return (await navigator.permissions.query({ name: 'camera' as PermissionName })).state;
  } catch { return null; }
}

async function notifyPanel(): Promise<boolean> {
  let timer: number | undefined;
  try {
    const expired = new Promise<undefined>((resolve) => { timer = window.setTimeout(() => resolve(undefined), 3000); });
    const response: unknown = await Promise.race([
      chrome.runtime.sendMessage({ channel: CHANNEL, type: 'granted', requestId }), expired,
    ]);
    return !!response && typeof response === 'object' && (response as { ok?: unknown }).ok === true;
  } catch { return false; }
  finally { if (timer !== undefined) window.clearTimeout(timer); }
}

async function requestCamera(): Promise<void> {
  if (closed || busy) return;
  busy = true;
  const currentAttempt = ++attempt;
  retry.hidden = true;
  settings.hidden = true;
  card.dataset.state = 'pending';
  title.textContent = 'Allow your camera';
  description.textContent = 'Choose Allow in your browser’s camera prompt to enable head tracking in Stillpoint.';
  status.textContent = 'Waiting for your browser…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    if (closed || currentAttempt !== attempt) { stopStream(stream); return; }
    temporaryStream = stream;
    // This window only obtains permission. The visible side panel owns the actual tracking camera.
    stopStream(temporaryStream);
    temporaryStream = null;
    card.dataset.state = 'success';
    title.textContent = 'Camera access allowed';
    description.textContent = 'Stillpoint can now use your camera for local head tracking. You can return to the side panel.';
    status.textContent = 'Returning to Stillpoint…';
    const acknowledged = await notifyPanel();
    if (closed || currentAttempt !== attempt) return;
    status.textContent = acknowledged
      ? 'Camera permission is ready. You can close this window.'
      : 'Camera permission is ready. Close this window and return to Stillpoint to start tracking.';
  } catch (error) {
    if (closed || currentAttempt !== attempt) return;
    const name = error instanceof DOMException || error instanceof Error ? error.name : '';
    const permission = name === 'NotAllowedError' || name === 'PermissionDeniedError' ? await permissionState() : null;
    if (closed || currentAttempt !== attempt) return;
    card.dataset.state = 'error';
    retry.hidden = false;
    if (permission === 'denied') {
      title.textContent = 'Camera access is blocked';
      description.textContent = 'Use the camera icon in this window’s address bar or your browser’s camera settings to allow Stillpoint. Then select Try again.';
      status.textContent = 'A saved browser or device permission must be changed before another request can work.';
      settings.hidden = false;
    } else if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      title.textContent = 'Camera permission wasn’t granted';
      description.textContent = 'Select Try again, then choose Allow in the browser’s camera prompt. If your device blocks camera access, enable it in your device settings first.';
      status.textContent = 'Head tracking will stay off until you allow camera access.';
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      title.textContent = 'No camera was found';
      description.textContent = 'Connect a camera or enable your device’s camera, then select Try again.';
      status.textContent = 'Stillpoint needs a working camera for head tracking.';
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      title.textContent = 'The camera couldn’t start';
      description.textContent = 'Another app may be using the camera. Close other camera apps and select Try again.';
      status.textContent = 'Head tracking is off. Your video remains under your control.';
    } else {
      title.textContent = 'Camera access couldn’t finish';
      description.textContent = 'Check that your camera is connected and available, then select Try again.';
      status.textContent = 'You can also close this window and use Stillpoint’s labelled simulation controls.';
    }
  } finally {
    busy = false;
    stopStream(temporaryStream);
    temporaryStream = null;
  }
}

retry.addEventListener('click', () => { void requestCamera(); });
close.addEventListener('click', () => { dispose(); window.close(); });
settings.addEventListener('click', () => {
  const url = navigator.userAgent.includes('Edg/') ? 'edge://settings/content/camera' : 'chrome://settings/content/camera';
  void chrome.tabs.create({ url }).catch(() => {
    status.textContent = 'Open your browser’s settings, find Site settings → Camera, and allow Stillpoint.';
  });
});
window.addEventListener('pagehide', dispose);
window.addEventListener('beforeunload', dispose);

if (requestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
  void requestCamera();
} else {
  card.dataset.state = 'error';
  title.textContent = 'Open camera setup from Stillpoint';
  description.textContent = 'Return to the Stillpoint side panel and choose Enable camera to begin.';
  status.textContent = 'This setup request is missing or has expired.';
}
