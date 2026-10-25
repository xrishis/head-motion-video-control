import { describe, expect, it } from 'vitest';
import { PlaybackPolicy } from './playbackPolicy';

const settings = { pauseDelayMs: 2_000, returnDelayMs: 1_000, autoResume: false };

describe('PlaybackPolicy', () => {
  it('pauses only after a continuous turn lasts the pause delay', () => {
    const policy = new PlaybackPolicy(settings);

    expect(policy.observe('away', 100, false)).toBeNull();
    expect(policy.observe('away', 2_099, false)).toBeNull();
    expect(policy.observe('away', 2_100, false)).toBe('pause');
    expect(policy.snapshot(2_100)).toEqual({
      ownsPause: true, pending: null, progress: 0,
    });
    expect(policy.observe('away', 5_000, true)).toBeNull();
  });

  it('restarts the pause delay after a brief look back at the lesson', () => {
    const policy = new PlaybackPolicy(settings);

    policy.observe('away', 0, false);
    expect(policy.observe('facing', 1_900, false)).toBeNull();
    expect(policy.observe('away', 2_000, false)).toBeNull();
    expect(policy.observe('away', 3_999, false)).toBeNull();
    expect(policy.observe('away', 4_000, false)).toBe('pause');
  });

  it('counts continuous away and absent observations toward the same pause', () => {
    const policy = new PlaybackPolicy(settings);

    policy.observe('away', 0, false);
    expect(policy.observe('absent', 1_000, false)).toBeNull();
    expect(policy.observe('absent', 2_000, false)).toBe('pause');
  });

  it('pauses after sustained face absence', () => {
    const policy = new PlaybackPolicy(settings);

    expect(policy.observe('absent', 0, false)).toBeNull();
    expect(policy.observe('absent', 1_999, false)).toBeNull();
    expect(policy.observe('absent', 2_000, false)).toBe('pause');
  });

  it('does not take ownership of a lesson that was already paused', () => {
    const policy = new PlaybackPolicy({ ...settings, autoResume: true });

    expect(policy.observe('away', 0, true)).toBeNull();
    expect(policy.observe('away', 5_000, true)).toBeNull();
    expect(policy.observe('facing', 6_000, true)).toBeNull();
    expect(policy.observe('facing', 10_000, true)).toBeNull();
    expect(policy.snapshot(10_000)).toEqual({
      ownsPause: false, pending: null, progress: 0,
    });
  });

  it('leaves an assistant-paused lesson paused when automatic resume is off', () => {
    const policy = new PlaybackPolicy(settings);

    policy.observe('away', 0, false);
    expect(policy.observe('away', 2_000, false)).toBe('pause');
    expect(policy.observe('facing', 3_000, true)).toBeNull();
    expect(policy.observe('facing', 20_000, true)).toBeNull();
    expect(policy.snapshot(20_000)).toEqual({
      ownsPause: true, pending: null, progress: 0,
    });
  });

  it('resumes an owned pause after a continuous confident return', () => {
    const policy = new PlaybackPolicy({ ...settings, autoResume: true });

    policy.observe('away', 0, false);
    policy.observe('away', 2_000, false);
    expect(policy.observe('facing', 3_000, true)).toBeNull();
    expect(policy.observe('facing', 3_999, true)).toBeNull();
    expect(policy.observe('facing', 4_000, true)).toBe('resume');
    expect(policy.snapshot(4_000)).toEqual({
      ownsPause: false, pending: null, progress: 0,
    });
    expect(policy.observe('facing', 5_000, true)).toBeNull();
  });

  it('keeps ownership through a brief return but restarts the return delay', () => {
    const policy = new PlaybackPolicy({ ...settings, autoResume: true });

    policy.observe('away', 0, false);
    policy.observe('away', 2_000, false);
    policy.observe('facing', 3_000, true);
    expect(policy.observe('away', 3_900, true)).toBeNull();
    expect(policy.snapshot(3_900).ownsPause).toBe(true);
    expect(policy.observe('facing', 4_000, true)).toBeNull();
    expect(policy.observe('facing', 4_999, true)).toBeNull();
    expect(policy.observe('facing', 5_000, true)).toBe('resume');
  });

  it('breaks a pending pause when tracking becomes unknown', () => {
    const policy = new PlaybackPolicy(settings);

    policy.observe('away', 0, false);
    expect(policy.observe('unknown', 1_900, false)).toBeNull();
    expect(policy.snapshot(1_900).pending).toBeNull();
    expect(policy.observe('away', 2_000, false)).toBeNull();
    expect(policy.observe('away', 3_999, false)).toBeNull();
    expect(policy.observe('away', 4_000, false)).toBe('pause');
  });

  it('never treats unknown tracking as a confident return', () => {
    const policy = new PlaybackPolicy({ ...settings, autoResume: true });

    policy.observe('away', 0, false);
    policy.observe('away', 2_000, false);
    policy.observe('facing', 3_000, true);
    expect(policy.observe('unknown', 3_999, true)).toBeNull();
    expect(policy.observe('unknown', 10_000, true)).toBeNull();
    expect(policy.snapshot(10_000)).toEqual({
      ownsPause: true, pending: null, progress: 0,
    });
    expect(policy.observe('facing', 11_000, true)).toBeNull();
    expect(policy.observe('facing', 11_999, true)).toBeNull();
    expect(policy.observe('facing', 12_000, true)).toBe('resume');
  });

  it('cancels a pending return when the face is absent again', () => {
    const policy = new PlaybackPolicy({ ...settings, autoResume: true });

    policy.observe('away', 0, false);
    policy.observe('away', 2_000, false);
    policy.observe('facing', 3_000, true);
    expect(policy.observe('absent', 3_999, true)).toBeNull();
    expect(policy.observe('absent', 10_000, true)).toBeNull();
    expect(policy.snapshot(10_000)).toEqual({
      ownsPause: true, pending: null, progress: 0,
    });
  });

  it('honors a learner override after the assistant pauses', () => {
    const policy = new PlaybackPolicy({ ...settings, autoResume: true });

    policy.observe('away', 0, false);
    policy.observe('away', 2_000, false);
    policy.observe('facing', 3_000, true);
    policy.manualAction();
    expect(policy.observe('facing', 10_000, true)).toBeNull();
    expect(policy.snapshot(10_000)).toEqual({
      ownsPause: false, pending: null, progress: 0,
    });
  });

  it('gives manual play a fresh pause delay', () => {
    const policy = new PlaybackPolicy(settings);

    policy.observe('away', 0, false);
    policy.observe('away', 1_900, false);
    policy.manualAction();
    expect(policy.observe('away', 2_000, false)).toBeNull();
    expect(policy.observe('away', 3_999, false)).toBeNull();
    expect(policy.observe('away', 4_000, false)).toBe('pause');
  });

  it('clears ownership and pending work when the lesson is reset', () => {
    const policy = new PlaybackPolicy({ ...settings, autoResume: true });

    policy.observe('away', 0, false);
    policy.observe('away', 2_000, false);
    policy.observe('facing', 3_000, true);
    policy.reset();
    expect(policy.observe('facing', 4_000, true)).toBeNull();
    expect(policy.snapshot(4_000)).toEqual({
      ownsPause: false, pending: null, progress: 0,
    });
    expect(policy.observe('away', 5_000, false)).toBeNull();
    expect(policy.observe('away', 6_999, false)).toBeNull();
    expect(policy.observe('away', 7_000, false)).toBe('pause');
  });

  it('restarts pending pause timing when settings change', () => {
    const policy = new PlaybackPolicy(settings);

    policy.observe('away', 0, false);
    policy.observe('away', 1_900, false);
    policy.configure({ ...settings, pauseDelayMs: 3_000 });
    expect(policy.snapshot(1_900).pending).toBeNull();
    expect(policy.observe('away', 2_000, false)).toBeNull();
    expect(policy.observe('away', 4_999, false)).toBeNull();
    expect(policy.observe('away', 5_000, false)).toBe('pause');
  });

  it('cancels pending automatic resume when the setting is turned off', () => {
    const policy = new PlaybackPolicy({ ...settings, autoResume: true });

    policy.observe('away', 0, false);
    policy.observe('away', 2_000, false);
    policy.observe('facing', 3_000, true);
    policy.configure(settings);
    expect(policy.observe('facing', 20_000, true)).toBeNull();
    expect(policy.snapshot(20_000)).toEqual({
      ownsPause: true, pending: null, progress: 0,
    });
    policy.configure({ ...settings, autoResume: true });
    expect(policy.observe('facing', 21_000, true)).toBeNull();
    expect(policy.observe('facing', 21_999, true)).toBeNull();
    expect(policy.observe('facing', 22_000, true)).toBe('resume');
  });

  it('reports bounded pending progress without making playback decisions', () => {
    const policy = new PlaybackPolicy(settings);

    policy.observe('away', 100, false);
    expect(policy.snapshot(0)).toEqual({
      ownsPause: false, pending: 'pause', progress: 0,
    });
    expect(policy.snapshot(1_100)).toEqual({
      ownsPause: false, pending: 'pause', progress: 0.5,
    });
    expect(policy.snapshot(10_000)).toEqual({
      ownsPause: false, pending: 'pause', progress: 1,
    });
    expect(policy.observe('away', 2_100, false)).toBe('pause');
  });

  it('reports progress for an owned return', () => {
    const policy = new PlaybackPolicy({ ...settings, autoResume: true });

    policy.observe('away', 0, false);
    policy.observe('away', 2_000, false);
    policy.observe('facing', 3_000, true);
    expect(policy.snapshot(3_500)).toEqual({
      ownsPause: true, pending: 'resume', progress: 0.5,
    });
  });

  it('discards backwards observations and restarts timing on the next observation', () => {
    const policy = new PlaybackPolicy(settings);

    policy.observe('away', 1_000, false);
    policy.observe('away', 2_000, false);
    expect(policy.observe('away', 500, false)).toBeNull();
    expect(policy.snapshot(500).pending).toBeNull();
    expect(policy.observe('away', 600, false)).toBeNull();
    expect(policy.observe('away', 2_599, false)).toBeNull();
    expect(policy.observe('away', 2_600, false)).toBe('pause');
  });

  it('allows a zero delay without requiring a second observation', () => {
    const policy = new PlaybackPolicy({
      pauseDelayMs: 0, returnDelayMs: 0, autoResume: true,
    });

    expect(policy.observe('away', 100, false)).toBe('pause');
    expect(policy.observe('facing', 200, true)).toBe('resume');
  });
});
