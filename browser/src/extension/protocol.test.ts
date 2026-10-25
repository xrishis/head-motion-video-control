import { describe, expect, it } from 'vitest';
import { normalizeSettings, validObservation } from './protocol';

describe('extension message boundaries', () => {
  it('accepts complete finite observations and rejects malformed or replay sequence shapes', () => {
    expect(validObservation({ pose: 'facing', capturedAt: 1000, sequence: 1 })).toBe(true);
    for (const bad of [null, {}, { pose: 'left', capturedAt: 1000, sequence: 1 }, { pose: 'away', capturedAt: NaN, sequence: 1 }, { pose: 'away', capturedAt: 1000, sequence: -1 }, { pose: 'away', capturedAt: 1000, sequence: 1.5 }]) {
      expect(validObservation(bad)).toBe(false);
    }
  });
  it('bounds timing to supported values and prevents truthy inputs from enabling resume', () => {
    expect(normalizeSettings({ pauseDelayMs: -10, returnDelayMs: 9000, autoResume: 'yes', sensitivity: 'unsafe' })).toEqual({ pauseDelayMs: 1000, returnDelayMs: 3000, autoResume: false, sensitivity: 'balanced' });
    expect(normalizeSettings({ pauseDelayMs: 3000, returnDelayMs: 1500, autoResume: true, sensitivity: 'sensitive' })).toEqual({ pauseDelayMs: 3000, returnDelayMs: 1500, autoResume: true, sensitivity: 'sensitive' });
  });
  it('uses safe defaults for missing, nonfinite and wrong-type persisted settings', () => {
    expect(normalizeSettings({ pauseDelayMs: Infinity, returnDelayMs: '500', autoResume: 1 })).toEqual({ pauseDelayMs: 2000, returnDelayMs: 1000, autoResume: false, sensitivity: 'balanced' });
  });
});
