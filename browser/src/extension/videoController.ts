import { PlaybackPolicy } from '../core/playbackPolicy';
import { epochNow, MAX_SIGNAL_AGE_MS, normalizeSettings, validObservation } from './protocol';
import type { ExtensionSettings, Observation, VideoAction, VideoStatus } from './protocol';

interface Source {
  url: string;
  attribute: string;
  stream: HTMLVideoElement['srcObject'];
}
interface PlayOperation {
  video: HTMLVideoElement;
  source: Source;
  canceled: boolean;
  automatic: boolean;
  revision: number;
  intent: PlaybackIntent;
  eventSeen: boolean;
}
interface PlaybackIntent { paused: boolean; revision: number; plays: Set<PlayOperation>; pauseEvents: number }
// Attachment replacement must share the latest intent for an existing element:
// an older unresolved play cannot undo a newer controller's explicit Play.
const playbackIntents = new WeakMap<HTMLVideoElement, PlaybackIntent>();
function intentFor(video: HTMLVideoElement): PlaybackIntent {
  let intent = playbackIntents.get(video);
  if (!intent) { intent = { paused: video.paused, revision: 0, plays: new Set(), pauseEvents: 0 }; playbackIntents.set(video, intent); }
  return intent;
}
const sourceOf = (video: HTMLVideoElement): Source => ({ url: video.currentSrc, attribute: video.src, stream: video.srcObject });
const sameSource = (video: HTMLVideoElement, source: Source) => video.currentSrc === source.url && video.src === source.attribute && video.srcObject === source.stream;
const MEDIA_EVENTS = ['play', 'pause', 'seeking', 'ended', 'emptied', 'loadstart', 'loadedmetadata'] as const;

/** One explicitly attached, top-level document. No page messaging bridge. */
export class ExtensionVideoController {
  private readonly policy: PlaybackPolicy;
  private readonly timer: ReturnType<typeof setInterval>;
  private video: HTMLVideoElement | null = null;
  private source: Source | null = null;
  private latest: Observation | null = null;
  private lastSequence = -1;
  private videoCount = 0;
  private destroyed = false;
  private message = 'Connected. Enable tracking to assist this video.';
  private readonly plays = new Set<PlayOperation>();

  constructor(private readonly document: Document, settings: ExtensionSettings, token: string, private readonly now: () => number = epochNow) {
    if (!token) throw new Error('A target session is required.');
    this.policy = new PlaybackPolicy(normalizeSettings(settings));
    this.document.addEventListener('visibilitychange', this.visibilityChanged);
    this.document.addEventListener('pointerdown', this.manualPointer, true);
    this.document.addEventListener('keydown', this.manualKey, true);
    this.refreshVideo();
    this.timer = globalThis.setInterval(() => this.tick(), 100);
  }

  observe(observation: Observation): void {
    if (this.destroyed) return;
    const now = this.now();
    this.safetyCheck(now);
    if (!validObservation(observation)) { this.reset(); return; }
    if (observation.sequence <= this.lastSequence) return;
    if (!this.fresh(observation, now)) {
      this.reset();
      this.message = 'Tracking signal expired. Playback stays under your control.';
      return;
    }
    this.lastSequence = observation.sequence;
    if (this.document.hidden || !this.video) return;
    this.latest = { ...observation };
    this.tick();
  }

  configure(settings: ExtensionSettings): void {
    if (this.destroyed) return;
    this.reset();
    this.policy.configure(normalizeSettings(settings));
  }

  async control(action: VideoAction): Promise<void> {
    if (this.destroyed || !['play', 'pause', 'rewind'].includes(action)) return;
    this.refreshVideo();
    const video = this.video;
    if (!video) return;
    this.manualAction(action === 'pause' ? true : action === 'play' ? false : video.paused);
    if (action === 'play') await this.play(video, false);
    else if (action === 'pause') { this.pause(video); this.message = 'Paused by you. Press Play when you are ready.'; }
    else {
      try { video.currentTime = Math.max(0, video.currentTime - 10); this.message = 'Rewound ten seconds.'; }
      catch { this.message = 'This player does not allow seeking right now.'; }
    }
  }

  reset(): void {
    for (const operation of this.plays) {
      if (!operation.automatic) continue;
      operation.canceled = true;
      // A tracking reset may cancel an automatic resume, but cannot replace a
      // later user Play/Pause intent or affect a different selected element.
      if (operation.intent.revision === operation.revision) {
        operation.intent.revision++;
        operation.intent.paused = true;
      }
    }
    this.latest = null;
    this.policy.reset();
  }

  status(): VideoStatus {
    if (!this.destroyed) this.safetyCheck(this.now());
    const snapshot = this.policy.snapshot(this.now());
    const hostname = this.document.location.hostname;
    const site = /(^|\.)youtube\.com$/.test(hostname) ? 'youtube' : /(^|\.)netflix\.com$/.test(hostname) ? 'netflix' : 'html5';
    return {
      connected: !this.destroyed, videoFound: this.video !== null,
      paused: this.video?.paused ?? true, ...snapshot,
      message: this.destroyed ? 'Disconnected.' : !this.video ? 'No visible standard video found on this page.' : this.message,
      site, videoCount: this.videoCount,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.reset();
    this.destroyed = true;
    globalThis.clearInterval(this.timer);
    this.document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.document.removeEventListener('pointerdown', this.manualPointer, true);
    this.document.removeEventListener('keydown', this.manualKey, true);
    this.listen(this.video, false);
    this.video = null;
    this.source = null;
  }

  private fresh(observation: Observation, now: number): boolean {
    const age = now - observation.capturedAt;
    return Number.isFinite(now) && age >= -50 && age <= MAX_SIGNAL_AGE_MS;
  }

  private safetyCheck(now: number): void {
    this.refreshVideo();
    if (this.document.hidden) {
      this.reset();
      this.message = 'Assistance suspended while the video tab is hidden.';
    } else if (this.latest && !this.fresh(this.latest, now)) {
      this.reset();
      this.message = 'Tracking signal expired. Playback stays under your control.';
    }
  }

  private tick(): void {
    if (this.destroyed) return;
    const now = this.now();
    this.safetyCheck(now);
    const video = this.video;
    if (!video || !this.latest || this.document.hidden || video.ended || video.seeking || video.readyState < 2) return;
    // Recheck the capture timestamp at the decision boundary, independently of
    // reception and timer scheduling. A delayed event loop cannot finish a dwell.
    if (!this.fresh(this.latest, this.now())) { this.reset(); return; }
    const action = this.policy.observe(this.latest.pose, now, video.paused);
    if (action === 'pause') {
      this.pause(video);
      this.message = 'Paused by your assistant. Take your time.';
    } else if (action === 'resume') {
      void this.play(video, true);
    }
  }

  private visibleArea(video: HTMLVideoElement): number {
    if (!video.isConnected || video.hidden || !this.document.contains(video)) return 0;
    const view = this.document.defaultView;
    if (!view) return 0;
    for (let element: HTMLElement | null = video; element; element = element.parentElement) {
      const style = view.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return 0;
    }
    const rect = video.getBoundingClientRect();
    // Exclude tiny previews. Measure the part of the element actually in view.
    if (rect.width < 160 || rect.height < 90) return 0;
    const width = Math.max(0, Math.min(rect.right, view.innerWidth) - Math.max(0, rect.left));
    const height = Math.max(0, Math.min(rect.bottom, view.innerHeight) - Math.max(0, rect.top));
    return width * height;
  }

  private refreshVideo(): void {
    const candidates = Array.from(this.document.querySelectorAll<HTMLVideoElement>('video'))
      .map(video => ({ video, area: this.visibleArea(video) }))
      .filter(candidate => candidate.area > 0)
      .sort((a, b) => b.area - a.area);
    this.videoCount = candidates.length;
    const preferred = this.document.querySelector<HTMLVideoElement>('#movie_player video');
    const next = candidates.find(candidate => candidate.video === preferred)?.video ?? candidates[0]?.video ?? null;
    if (next !== this.video) {
      this.reset();
      if (this.video) intentFor(this.video).pauseEvents = 0;
      this.listen(this.video, false);
      this.video = next;
      this.source = next ? sourceOf(next) : null;
      this.listen(next, true);
      this.message = next ? 'Video connected. Playback stays under your control.' : 'Waiting for a visible video.';
    } else if (next && this.source && !sameSource(next, this.source)) {
      this.reset();
      intentFor(next).pauseEvents = 0;
      this.source = sourceOf(next);
      this.message = 'Video source changed. Playback stays under your control.';
    }
  }

  private listen(video: HTMLVideoElement | null, enabled: boolean): void {
    for (const event of MEDIA_EVENTS) {
      if (enabled) video?.addEventListener(event, this.mediaEvent);
      else video?.removeEventListener(event, this.mediaEvent);
    }
  }

  private readonly mediaEvent = (event: Event): void => {
    const video = this.video;
    if (!video || event.target !== video) return;
    if (event.type === 'pause') {
      const intent = intentFor(video);
      // Media events are queued. Keep an already issued Pause recognizable even
      // after a reset/manual Play or a new attachment replaces this controller.
      if (intent.pauseEvents > 0) { intent.pauseEvents--; return; }
    }
    if (event.type === 'play') {
      const operation = Array.from(intentFor(video).plays).find(play => !play.eventSeen && sameSource(video, play.source));
      if (operation) {
        this.validatePlayCompletion(operation);
        operation.eventSeen = true;
        if (operation.canceled && operation.intent.paused) this.pause(video);
        return;
      }
    }
    this.manualAction(event.type === 'pause' ? true : event.type === 'play' ? false : video.paused);
    if (event.type === 'loadstart' || event.type === 'emptied' || event.type === 'loadedmetadata') {
      this.source = sourceOf(video);
      intentFor(video).pauseEvents = 0;
    }
    this.message = event.type === 'pause' ? 'Paused by you. Press Play when you are ready.' : 'Playback stays under your control.';
  };

  private manualAction(desiredPaused: boolean): void {
    if (this.video) {
      const intent = intentFor(this.video);
      intent.revision++;
      intent.paused = desiredPaused;
      for (const operation of intent.plays) operation.canceled = true;
    }
    this.policy.manualAction();
    this.latest = null;
  }

  private pause(video: HTMLVideoElement): void {
    if (video.paused) return;
    const intent = intentFor(video);
    intent.pauseEvents++;
    try { video.pause(); }
    catch { intent.pauseEvents = Math.max(0, intent.pauseEvents - 1); this.reset(); this.message = 'This player could not be paused.'; }
  }

  private async play(video: HTMLVideoElement, automatic: boolean): Promise<void> {
    const intent = intentFor(video);
    intent.paused = false;
    const operation: PlayOperation = { video, source: sourceOf(video), canceled: false, automatic, revision: ++intent.revision, intent, eventSeen: false };
    this.plays.add(operation);
    intent.plays.add(operation);
    try {
      await video.play();
      this.validatePlayCompletion(operation);
      if (operation.canceled) {
        // Never change a replacement/source or overwrite a later explicit Play.
        if (operation.intent.paused && sameSource(video, operation.source)) this.pause(video);
      } else this.message = 'Your lesson is playing.';
    } catch {
      if (!operation.canceled) { this.reset(); this.message = 'Click Play on the video page once, then try again.'; }
    } finally {
      this.plays.delete(operation);
      intent.plays.delete(operation);
    }
  }

  private validatePlayCompletion(operation: PlayOperation): void {
    if (!operation.automatic || operation.canceled) return;
    if (this.destroyed || this.video !== operation.video || !sameSource(operation.video, operation.source) ||
      this.document.hidden || operation.video.ended || operation.video.seeking ||
      !this.latest || this.latest.pose !== 'facing' || !this.fresh(this.latest, this.now())) {
      this.reset();
      this.message = 'Tracking changed before playback began. Press Play to continue.';
    }
  }

  private readonly visibilityChanged = (): void => {
    this.reset();
    this.message = this.document.hidden ? 'Assistance suspended while the video tab is hidden.' : 'Video tab visible. Waiting for fresh tracking.';
  };

  private readonly manualPointer = (event: Event): void => {
    const video = this.video;
    if (!video) return;
    const target = event.target as Element | null;
    const player = video.closest('#movie_player');
    if (target && (video === target || player?.contains(target))) this.manualAction(video.paused);
  };

  private readonly manualKey = (event: Event): void => {
    const key = (event as KeyboardEvent).key;
    const target = event.target as HTMLElement | null;
    if (!this.video || target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
    if ([' ', 'k', 'K', 'j', 'J', 'l', 'L', 'ArrowLeft', 'ArrowRight', 'MediaPlayPause', 'MediaPlay', 'MediaPause'].includes(key)) this.manualAction(this.video.paused);
  };
}
