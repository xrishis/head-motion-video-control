import { afterEach, describe, expect, it, vi } from 'vitest';
import { PoseFreshness, TrackingObservationProcessor } from './useCameraTracking';
import { PlaybackPolicy, type PoseState } from '../core/playbackPolicy';

const neutralMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const yaw30 = [0.8660254038, 0, -0.5, 0, 0, 1, 0, 0, 0.5, 0, 0.8660254038, 0, 0, 0, 0, 1];
const yaw20 = [0.9396926208, 0, -0.3420201433, 0, 0, 1, 0, 0, 0.3420201433, 0, 0.9396926208, 0, 0, 0, 0, 1];

function calibrate(processor: TrackingObservationProcessor): void {
  for (let timestamp = 0; timestamp <= 2_000; timestamp += 100) {
    processor.observe({ faceCount: 1, matrix: neutralMatrix, timestamp }, 'balanced');
  }
}

describe('camera observation processing', () => {
  it('withholds facing observations until stable neutral calibration completes', () => {
    const processor = new TrackingObservationProcessor();
    expect(processor.observe({ faceCount: 1, matrix: neutralMatrix, timestamp: 0 }, 'balanced')).toMatchObject({
      status: 'calibrating', pose: 'unknown', progress: 0,
    });
    for (let timestamp = 100; timestamp < 2_000; timestamp += 100) {
      expect(processor.observe({ faceCount: 1, matrix: neutralMatrix, timestamp }, 'balanced').pose).toBe('unknown');
    }
    expect(processor.observe({ faceCount: 1, matrix: neutralMatrix, timestamp: 2_000 }, 'balanced')).toMatchObject({
      status: 'tracking', pose: 'facing', progress: 1,
    });
  });

  it('restarts unfinished calibration when the face disappears', () => {
    const processor = new TrackingObservationProcessor();
    for (let timestamp = 0; timestamp <= 1_900; timestamp += 100) {
      processor.observe({ faceCount: 1, matrix: neutralMatrix, timestamp }, 'balanced');
    }
    expect(processor.observe({ faceCount: 0, matrix: null, timestamp: 2_000 }, 'balanced')).toMatchObject({
      status: 'calibrating', pose: 'absent', progress: 0, orientation: null,
    });
    expect(processor.observe({ faceCount: 1, matrix: neutralMatrix, timestamp: 2_100 }, 'balanced')).toMatchObject({
      status: 'calibrating', pose: 'unknown', progress: 0,
    });
  });

  it('treats multiple faces as unknown and clears an unfinished calibration window', () => {
    const processor = new TrackingObservationProcessor();
    for (let timestamp = 0; timestamp <= 1_900; timestamp += 100) {
      processor.observe({ faceCount: 1, matrix: neutralMatrix, timestamp }, 'balanced');
    }
    expect(processor.observe({ faceCount: 2, matrix: neutralMatrix, timestamp: 2_000 }, 'balanced')).toMatchObject({
      status: 'calibrating', pose: 'unknown', progress: 0, orientation: null,
    });
    expect(processor.observe({ faceCount: 1, matrix: neutralMatrix, timestamp: 2_100 }, 'balanced').progress).toBe(0);
  });

  it('never converts a missing or invalid transformation matrix into facing', () => {
    const processor = new TrackingObservationProcessor();
    calibrate(processor);
    expect(processor.observe({ faceCount: 1, matrix: null, timestamp: 2_100 }, 'balanced')).toMatchObject({
      status: 'tracking', pose: 'unknown', orientation: null,
    });
    expect(processor.observe({ faceCount: 1, matrix: Array(16).fill(0), timestamp: 2_200 }, 'balanced').pose).toBe('unknown');
    expect(processor.observe({ faceCount: 1, matrix: neutralMatrix, timestamp: 2_300 }, 'balanced').pose).toBe('facing');
  });

  it('preserves the completed baseline through absence and ambiguous observations', () => {
    const processor = new TrackingObservationProcessor();
    calibrate(processor);
    expect(processor.observe({ faceCount: 0, matrix: null, timestamp: 2_100 }, 'balanced').pose).toBe('absent');
    expect(processor.observe({ faceCount: 2, matrix: null, timestamp: 2_200 }, 'balanced').pose).toBe('unknown');
    expect(processor.observe({ faceCount: 1, matrix: yaw30, timestamp: 2_300 }, 'balanced')).toMatchObject({
      status: 'tracking', pose: 'away', progress: 1,
    });
  });

  it('requires the closer hysteresis threshold after a turn', () => {
    const processor = new TrackingObservationProcessor();
    calibrate(processor);
    expect(processor.observe({ faceCount: 1, matrix: yaw20, timestamp: 2_100 }, 'balanced').pose).toBe('facing');
    expect(processor.observe({ faceCount: 1, matrix: yaw30, timestamp: 2_200 }, 'balanced').pose).toBe('away');
    expect(processor.observe({ faceCount: 1, matrix: yaw20, timestamp: 2_300 }, 'balanced').pose).toBe('away');
    expect(processor.observe({ faceCount: 1, matrix: neutralMatrix, timestamp: 2_400 }, 'balanced').pose).toBe('facing');
  });

  it.each([
    { sensitivity: 'relaxed' as const, pose: 'facing' },
    { sensitivity: 'balanced' as const, pose: 'facing' },
    { sensitivity: 'sensitive' as const, pose: 'away' },
  ])('applies $sensitivity sensitivity to relative orientation', ({ sensitivity, pose }) => {
    const processor = new TrackingObservationProcessor();
    calibrate(processor);
    expect(processor.observe({ faceCount: 1, matrix: yaw20, timestamp: 2_100 }, sensitivity).pose).toBe(pose);
  });

  it('requires a fresh calibration after an explicit lifecycle reset', () => {
    const processor = new TrackingObservationProcessor();
    calibrate(processor);
    processor.reset();
    expect(processor.observe({ faceCount: 1, matrix: yaw30, timestamp: 3_000 }, 'balanced')).toMatchObject({
      status: 'calibrating', pose: 'unknown', progress: 0,
    });
  });

  it('clears unfinished calibration when the published observation expires', () => {
    const processor = new TrackingObservationProcessor();
    for (let timestamp = 0; timestamp <= 1_900; timestamp += 100) {
      processor.observe({ faceCount: 1, matrix: neutralMatrix, timestamp }, 'balanced');
    }
    expect(processor.invalidate()).toMatchObject({
      status: 'calibrating', pose: 'unknown', progress: 0, orientation: null,
    });
    expect(processor.observe({ faceCount: 1, matrix: neutralMatrix, timestamp: 2_100 }, 'balanced')).toMatchObject({
      status: 'calibrating', pose: 'unknown', progress: 0,
    });
  });

  it('invalidates cached tracking without discarding a completed baseline', () => {
    const processor = new TrackingObservationProcessor();
    calibrate(processor);
    expect(processor.invalidate()).toMatchObject({
      status: 'tracking', pose: 'unknown', progress: 1, orientation: null,
    });
    expect(processor.observe({ faceCount: 1, matrix: yaw30, timestamp: 3_000 }, 'balanced').pose).toBe('away');
  });
});

describe('published camera pose freshness', () => {
  afterEach(() => vi.useRealTimers());

  it('expires cached poses 350 ms after capture, including time spent in inference', () => {
    vi.useFakeTimers();
    let expirations = 0;
    const freshness = new PoseFreshness(() => { expirations++; });

    expect(freshness.accept(1_000, 1_200)).toBe(true);
    vi.advanceTimersByTime(149);
    expect(expirations).toBe(0);
    vi.advanceTimersByTime(1);
    expect(expirations).toBe(1);
    vi.advanceTimersByTime(5_000);
    expect(expirations).toBe(1);
  });

  it.each([350, 500, 5_000])('rejects a result already %i ms old', age => {
    vi.useFakeTimers();
    let expirations = 0;
    const freshness = new PoseFreshness(() => { expirations++; });

    expect(freshness.accept(1_000, 1_000 + age)).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(expirations).toBe(0);
  });

  it('accepts a 349 ms old result only for its final millisecond', () => {
    vi.useFakeTimers();
    let expirations = 0;
    const freshness = new PoseFreshness(() => { expirations++; });

    expect(freshness.accept(1_000, 1_349)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(expirations).toBe(1);
  });

  it('replaces the previous deadline when a newer frame arrives', () => {
    vi.useFakeTimers();
    let expirations = 0;
    const freshness = new PoseFreshness(() => { expirations++; });

    freshness.accept(0, 0);
    vi.advanceTimersByTime(250);
    freshness.accept(250, 250);
    vi.advanceTimersByTime(100);
    expect(expirations).toBe(0);
    vi.advanceTimersByTime(250);
    expect(expirations).toBe(1);
  });

  it('cancels pending expiration during lifecycle cleanup', () => {
    vi.useFakeTimers();
    let expirations = 0;
    const freshness = new PoseFreshness(() => { expirations++; });

    freshness.accept(0, 0);
    freshness.clear();
    vi.advanceTimersByTime(5_000);
    expect(expirations).toBe(0);
  });

  it('invalidates stale facing before the shortest automatic return delay can complete', () => {
    vi.useFakeTimers();
    const processor = new TrackingObservationProcessor();
    calibrate(processor);
    const policy = new PlaybackPolicy({ pauseDelayMs: 1_000, returnDelayMs: 500, autoResume: true });
    policy.observe('away', 0, false);
    expect(policy.observe('away', 1_000, false)).toBe('pause');
    let pose: PoseState = processor.observe({ faceCount: 1, matrix: neutralMatrix, timestamp: 2_000 }, 'balanced').pose;
    const decisions: Array<'pause' | 'resume' | null> = [];
    let elapsed = 0;
    // The player's recurring policy tick exists before the latest result deadline.
    const interval = setInterval(() => {
      elapsed += 100;
      decisions.push(policy.observe(pose, 2_000 + elapsed, true));
    }, 100);
    const freshness = new PoseFreshness(() => { pose = processor.invalidate().pose; });
    freshness.accept(2_000, 2_000);
    expect(policy.observe(pose, 2_000, true)).toBeNull();

    vi.advanceTimersByTime(1_000);
    clearInterval(interval);
    expect(decisions).not.toContain('resume');
    expect(policy.snapshot(3_000)).toEqual({ ownsPause: true, pending: null, progress: 0 });
  });
});
