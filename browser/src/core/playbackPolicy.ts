export type PoseState = 'facing' | 'away' | 'absent' | 'unknown';

export interface PolicySettings {
  pauseDelayMs: number;
  returnDelayMs: number;
  autoResume: boolean;
}

export type PlaybackDecision = 'pause' | 'resume' | null;

export interface PolicySnapshot {
  ownsPause: boolean;
  pending: PlaybackDecision;
  progress: number;
}

export class PlaybackPolicy {
  private settings: PolicySettings;
  private ownsPause = false;
  private pending: PlaybackDecision = null;
  private startedAt: number | null = null;
  private lastObservedAt: number | null = null;

  constructor(settings: PolicySettings) {
    this.settings = { ...settings };
  }

  configure(settings: PolicySettings): void {
    this.settings = { ...settings };
    this.clearPending();
  }

  observe(pose: PoseState, now: number, paused: boolean): PlaybackDecision {
    if (!Number.isFinite(now)) {
      this.clearPending();
      this.lastObservedAt = null;
      return null;
    }

    if (this.lastObservedAt !== null && now < this.lastObservedAt) {
      this.clearPending();
      this.lastObservedAt = now;
      return null;
    }

    this.lastObservedAt = now;

    let decision: PlaybackDecision = null;
    if (!paused && (pose === 'away' || pose === 'absent')) {
      decision = 'pause';
    } else if (paused && pose === 'facing' && this.ownsPause && this.settings.autoResume) {
      decision = 'resume';
    }

    if (decision === null) {
      this.clearPending();
      return null;
    }

    if (this.pending !== decision) {
      this.pending = decision;
      this.startedAt = now;
    }

    const delay = decision === 'pause' ? this.settings.pauseDelayMs : this.settings.returnDelayMs;
    if (now - this.startedAt! < delay) return null;

    this.ownsPause = decision === 'pause';
    this.clearPending();
    return decision;
  }

  /** Call for any learner play/pause/seek intent, including intent while already paused. */
  manualAction(): void {
    this.reset();
  }

  /** Clear stale decisions on source, visibility, enablement, or tracking lifecycle changes. */
  reset(): void {
    this.ownsPause = false;
    this.clearPending();
    this.lastObservedAt = null;
  }

  snapshot(now: number): PolicySnapshot {
    let progress = 0;
    if (this.pending !== null && this.startedAt !== null && Number.isFinite(now)) {
      const delay = this.pending === 'pause' ? this.settings.pauseDelayMs : this.settings.returnDelayMs;
      progress = delay <= 0 ? 1 : Math.min(1, Math.max(0, (now - this.startedAt) / delay));
    }
    return { ownsPause: this.ownsPause, pending: this.pending, progress };
  }

  private clearPending(): void {
    this.pending = null;
    this.startedAt = null;
  }
}
