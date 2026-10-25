import { describe, expect, it } from 'vitest'
import { classifyOrientation, NeutralCalibration, orientationFromMatrix, type Orientation } from './pose'

const neutral: Orientation = { yaw: 0, pitch: 0, roll: 0 }
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

describe('orientationFromMatrix', () => {
  it('extracts a frontal neutral orientation from an identity basis', () => {
    expect(orientationFromMatrix(identity)).toEqual(neutral)
  })

  it.each([
    { name: 'positive yaw', data: [0.8660254038, 0, -0.5, 0, 0, 1, 0, 0, 0.5, 0, 0.8660254038, 0, 0, 0, 0, 1], expected: { yaw: 30, pitch: 0, roll: 0 } },
    { name: 'negative yaw', data: [0.8660254038, 0, 0.5, 0, 0, 1, 0, 0, -0.5, 0, 0.8660254038, 0, 0, 0, 0, 1], expected: { yaw: -30, pitch: 0, roll: 0 } },
    { name: 'positive pitch', data: [1, 0, 0, 0, 0, 0.8660254038, 0.5, 0, 0, -0.5, 0.8660254038, 0, 0, 0, 0, 1], expected: { yaw: 0, pitch: 30, roll: 0 } },
    { name: 'negative pitch', data: [1, 0, 0, 0, 0, 0.8660254038, -0.5, 0, 0, 0.5, 0.8660254038, 0, 0, 0, 0, 1], expected: { yaw: 0, pitch: -30, roll: 0 } },
    { name: 'roll', data: [0.8660254038, 0.5, 0, 0, -0.5, 0.8660254038, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], expected: { yaw: 0, pitch: 0, roll: 30 } },
    // Hand-calculated Rz(10°) Ry(30°) Rx(20°), stored column-major.
    { name: 'combined rotation', data: [0.852868532, 0.150383733, -0.5, 0, 0.005236133, 0.955112166, 0.296198133, 0, 0.522099464, -0.255236133, 0.813797681, 0, 0, 0, 0, 1], expected: { yaw: 30, pitch: 20, roll: 10 } },
  ])('extracts signed $name from a column-major rotation', ({ data, expected }) => {
    const actual = orientationFromMatrix(data)
    expect(actual).not.toBeNull()
    expect(actual!.yaw).toBeCloseTo(expected.yaw, 4)
    expect(actual!.pitch).toBeCloseTo(expected.pitch, 4)
    expect(actual!.roll).toBeCloseTo(expected.roll, 4)
  })

  it('ignores translation and positive basis scale', () => {
    expect(orientationFromMatrix([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 15, -2, -70, 1])).toEqual(neutral)
  })

  it.each([
    [], identity.slice(0, 15), [...identity, 0],
    identity.map((value, index) => index === 4 ? Number.NaN : value),
    identity.map((value, index) => index === 14 ? Infinity : value),
    Array(16).fill(0),
    [1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    [1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  ])('rejects malformed or non-rotation input %#', (...values) => {
    expect(orientationFromMatrix(values)).toBeNull()
  })

  it('rejects sparse matrix arrays rather than producing invalid angles', () => {
    expect(orientationFromMatrix(new Array<number>(16))).toBeNull()
  })

  it('keeps a 90-degree yaw finite at the Euler singularity', () => {
    const actual = orientationFromMatrix([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1])
    expect(actual).toEqual({ yaw: 90, pitch: 0, roll: 0 })
  })
})

describe('classifyOrientation', () => {
  it('uses yaw or pitch relative to the learner baseline', () => {
    const baseline = { yaw: 10, pitch: -10, roll: 3 }
    expect(classifyOrientation({ yaw: 33, pitch: -10, roll: 3 }, baseline, false, 24)).toBe('facing')
    expect(classifyOrientation({ yaw: 34, pitch: -10, roll: 3 }, baseline, false, 24)).toBe('away')
    expect(classifyOrientation({ yaw: 10, pitch: -35, roll: 3 }, baseline, false, 24)).toBe('away')
  })

  it('requires a closer return than the threshold used for leaving', () => {
    expect(classifyOrientation({ ...neutral, yaw: 20 }, neutral, false, 24)).toBe('facing')
    expect(classifyOrientation({ ...neutral, yaw: 20 }, neutral, true, 24)).toBe('away')
    expect(classifyOrientation({ ...neutral, yaw: 16 }, neutral, true, 24)).toBe('facing')
  })

  it('does not treat a head tilt alone as turning away', () => {
    expect(classifyOrientation({ ...neutral, roll: 50 }, neutral, false, 24)).toBe('facing')
  })

  it('compares angles across the signed 180-degree boundary', () => {
    expect(classifyOrientation({ ...neutral, yaw: -179 }, { ...neutral, yaw: 179 }, false, 24)).toBe('facing')
  })

  it('returns unknown for invalid observations, baselines, or thresholds', () => {
    expect(classifyOrientation({ ...neutral, yaw: NaN }, neutral, false, 24)).toBe('unknown')
    expect(classifyOrientation(neutral, { ...neutral, pitch: Infinity }, false, 24)).toBe('unknown')
    expect(classifyOrientation(neutral, neutral, false, 0)).toBe('unknown')
    expect(classifyOrientation(neutral, neutral, false, NaN)).toBe('unknown')
  })
})

describe('NeutralCalibration', () => {
  it('collects a mean neutral orientation only after a stable two-second window', () => {
    const calibration = new NeutralCalibration()
    for (let time = 0; time < 2000; time += 100) calibration.add({ yaw: time % 200 ? 11 : 9, pitch: -3, roll: 1 }, time)
    expect(calibration.baseline).toBeNull()
    expect(calibration.progress).toBeGreaterThan(0.8)
    calibration.add({ yaw: 10, pitch: -3, roll: 1 }, 2000)
    expect(calibration.status).toBe('complete')
    expect(calibration.progress).toBe(1)
    expect(calibration.baseline).toEqual({ yaw: 10, pitch: -3, roll: 1 })
  })

  it('requires enough independent observations as well as elapsed time', () => {
    const calibration = new NeutralCalibration()
    for (let time = 0; time <= 2000; time += 250) calibration.add(neutral, time)
    expect(calibration.baseline).toBeNull()
    expect(calibration.progress).toBeLessThan(1)
    for (let time = 2100; time <= 2600; time += 100) calibration.add(neutral, time)
    expect(calibration.status).toBe('complete')
  })

  it('does not complete with many samples from less than two seconds', () => {
    const calibration = new NeutralCalibration()
    for (let time = 0; time <= 1500; time += 50) calibration.add(neutral, time)
    expect(calibration.baseline).toBeNull()
    expect(calibration.progress).toBeCloseTo(0.75)
  })

  it('restarts stability after movement and does not learn an outlier as neutral', () => {
    const calibration = new NeutralCalibration()
    for (let time = 0; time <= 1500; time += 100) calibration.add(neutral, time)
    calibration.add({ ...neutral, yaw: 35 }, 1600)
    expect(calibration.status).toBe('unstable')
    expect(calibration.progress).toBe(0)
    calibration.add(neutral, 1700)
    for (let time = 1800; time <= 3600; time += 100) calibration.add(neutral, time)
    expect(calibration.baseline).toBeNull()
    calibration.add(neutral, 3700)
    expect(calibration.baseline).toEqual(neutral)
  })

  it('rejects slow accumulated movement rather than accepting small adjacent steps', () => {
    const calibration = new NeutralCalibration()
    for (let index = 0; index <= 20; index++) calibration.add({ ...neutral, yaw: index }, index * 100)
    expect(calibration.baseline).toBeNull()
    expect(calibration.progress).toBeLessThan(0.5)
  })

  it('requires continuous observations after a tracking gap', () => {
    const calibration = new NeutralCalibration()
    for (let time = 0; time <= 1000; time += 100) calibration.add(neutral, time)
    calibration.add(neutral, 4000)
    expect(calibration.baseline).toBeNull()
    expect(calibration.progress).toBe(0)
    for (let time = 4100; time <= 6000; time += 100) calibration.add(neutral, time)
    expect(calibration.baseline).toEqual(neutral)
  })

  it('does not count duplicate timestamps as new evidence', () => {
    const calibration = new NeutralCalibration()
    for (let time = 0; time <= 2000; time += 500) {
      for (let duplicate = 0; duplicate < 10; duplicate++) calibration.add(neutral, time)
    }
    expect(calibration.baseline).toBeNull()
  })

  it('invalid observations clear the pending window without poisoning the next baseline', () => {
    const calibration = new NeutralCalibration()
    for (let time = 0; time <= 1000; time += 100) calibration.add(neutral, time)
    calibration.add({ ...neutral, pitch: NaN }, 1100)
    expect(calibration.status).toBe('unstable')
    expect(calibration.progress).toBe(0)
    for (let time = 1200; time <= 3200; time += 100) calibration.add(neutral, time)
    expect(calibration.baseline).toEqual(neutral)
  })

  it('restarts after a backwards clock', () => {
    const calibration = new NeutralCalibration()
    for (let time = 1000; time <= 2500; time += 100) calibration.add(neutral, time)
    calibration.add(neutral, 500)
    expect(calibration.progress).toBe(0)
    expect(calibration.baseline).toBeNull()
  })

  it('holds the completed baseline until explicitly recalibrated', () => {
    const calibration = new NeutralCalibration()
    for (let time = 0; time <= 2000; time += 100) calibration.add(neutral, time)
    calibration.add({ yaw: 40, pitch: 30, roll: 10 }, 2200)
    expect(calibration.baseline).toEqual(neutral)
    calibration.reset()
    expect(calibration.baseline).toBeNull()
    expect(calibration.progress).toBe(0)
    expect(calibration.status).toBe('collecting')
  })
})
