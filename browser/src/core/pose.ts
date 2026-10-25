import type { PoseState } from './playbackPolicy'

export interface Orientation {
  yaw: number
  pitch: number
  roll: number
}

const degrees = 180 / Math.PI
const axes = ['yaw', 'pitch', 'roll'] as const
const isFiniteOrientation = (orientation: Orientation): boolean => axes.every(axis => Number.isFinite(orientation[axis]))
const wrapAngle = (angle: number): number => ((angle + 180) % 360 + 360) % 360 - 180
const cleanZero = (angle: number): number => Math.abs(angle) < 1e-10 ? 0 : angle

/** MediaPipe affine matrices are column-major; angles use Rz(roll) Ry(yaw) Rx(pitch). */
export function orientationFromMatrix(data: readonly number[]): Orientation | null {
  if (data.length !== 16 || !Array.from(data).every(Number.isFinite)) return null
  if (Math.abs(data[3]) > 0.001 || Math.abs(data[7]) > 0.001 || Math.abs(data[11]) > 0.001 || Math.abs(data[15] - 1) > 0.001) return null

  // Remove positive basis scale, while rejecting collapsed, skewed, or reflected bases.
  const columns = [0, 4, 8].map(index => [data[index], data[index + 1], data[index + 2]])
  const lengths = columns.map(column => Math.hypot(...column))
  if (lengths.some(length => length < 1e-8)) return null
  const [x, y, z] = columns.map((column, index) => column.map(value => value / lengths[index]))
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  if (Math.abs(dot(x, y)) > 0.05 || Math.abs(dot(y, z)) > 0.05 || Math.abs(dot(z, x)) > 0.05) return null
  const determinant = x[0] * (y[1] * z[2] - y[2] * z[1]) - y[0] * (x[1] * z[2] - x[2] * z[1]) + z[0] * (x[1] * y[2] - x[2] * y[1])
  if (determinant < 0.9) return null

  const cosYaw = Math.hypot(x[0], x[1])
  const yaw = Math.atan2(-x[2], cosYaw)
  // At a gimbal singularity choose roll=0, yielding an equivalent finite orientation.
  const pitch = cosYaw > 1e-6 ? Math.atan2(y[2], z[2]) : Math.atan2(-z[1], y[1])
  const roll = cosYaw > 1e-6 ? Math.atan2(x[1], x[0]) : 0
  return { yaw: cleanZero(yaw * degrees), pitch: cleanZero(pitch * degrees), roll: cleanZero(roll * degrees) }
}

/** Roll alone does not mean the learner has turned away. Return requires a 30% smaller angle. */
export function classifyOrientation(current: Orientation, baseline: Orientation, wasAway: boolean, threshold: number): PoseState {
  if (!isFiniteOrientation(current) || !isFiniteOrientation(baseline) || !Number.isFinite(threshold) || threshold <= 0) return 'unknown'
  const deviation = Math.max(Math.abs(wrapAngle(current.yaw - baseline.yaw)), Math.abs(wrapAngle(current.pitch - baseline.pitch)))
  return (wasAway ? deviation > threshold * 0.7 : deviation >= threshold) ? 'away' : 'facing'
}

interface CalibrationWindow {
  anchor: Orientation
  min: Orientation
  max: Orientation
  sum: Orientation
  count: number
  start: number
  last: number
}

export class NeutralCalibration {
  private window: CalibrationWindow | null = null
  private result: Orientation | null = null
  private state: 'collecting' | 'unstable' | 'complete' = 'collecting'

  add(orientation: Orientation, now: number): void {
    if (this.result) return
    if (!isFiniteOrientation(orientation) || !Number.isFinite(now)) {
      this.reset()
      this.state = 'unstable'
      return
    }
    if (!this.window) {
      this.begin(orientation, now, 'collecting')
      return
    }
    const window = this.window
    if (now === window.last) return
    if (now < window.last || now - window.last > 500) {
      this.begin(orientation, now, 'unstable')
      return
    }
    const unwrapped = { ...orientation }
    for (const axis of axes) {
      unwrapped[axis] = window.anchor[axis] + wrapAngle(orientation[axis] - window.anchor[axis])
      if (Math.max(window.max[axis], unwrapped[axis]) - Math.min(window.min[axis], unwrapped[axis]) > 5) {
        this.begin(orientation, now, 'unstable')
        return
      }
    }
    for (const axis of axes) {
      window.min[axis] = Math.min(window.min[axis], unwrapped[axis])
      window.max[axis] = Math.max(window.max[axis], unwrapped[axis])
      window.sum[axis] += unwrapped[axis]
    }
    window.count++
    window.last = now
    this.state = 'collecting'
    if (now - window.start >= 2000 && window.count >= 15) {
      this.result = {
        yaw: cleanZero(wrapAngle(window.sum.yaw / window.count)),
        pitch: cleanZero(wrapAngle(window.sum.pitch / window.count)),
        roll: cleanZero(wrapAngle(window.sum.roll / window.count)),
      }
      this.state = 'complete'
    }
  }

  reset(): void {
    this.window = null
    this.result = null
    this.state = 'collecting'
  }

  get progress(): number {
    if (this.result) return 1
    if (!this.window) return 0
    return Math.min(1, (this.window.last - this.window.start) / 2000, this.window.count / 15)
  }

  get baseline(): Orientation | null { return this.result ? { ...this.result } : null }
  get status(): 'collecting' | 'unstable' | 'complete' { return this.state }

  private begin(orientation: Orientation, now: number, state: 'collecting' | 'unstable'): void {
    this.window = { anchor: { ...orientation }, min: { ...orientation }, max: { ...orientation }, sum: { ...orientation }, count: 1, start: now, last: now }
    this.state = state
  }
}
