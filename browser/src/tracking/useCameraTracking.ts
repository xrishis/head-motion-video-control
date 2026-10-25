import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { PoseState } from '../core/playbackPolicy';
import { classifyOrientation, NeutralCalibration, orientationFromMatrix, type Orientation } from '../core/pose';

type Sensitivity = 'relaxed' | 'balanced' | 'sensitive';
export type CameraStatus = 'off' | 'loading' | 'calibrating' | 'tracking' | 'error';
interface TrackingResult { faceCount: number; matrix: readonly number[] | null; timestamp: number }
interface Observation {
  status: 'calibrating' | 'tracking';
  pose: PoseState;
  progress: number;
  orientation: Orientation | null;
  message: string;
}

export const MAX_POSE_AGE_MS = 350;

/** Bounds a published pose by capture time, independently of the fatal worker watchdog. */
export class PoseFreshness {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onExpire: () => void;

  constructor(onExpire: () => void) {
    this.onExpire = onExpire;
  }

  accept(capturedAt: number, now: number): boolean {
    this.clear();
    const age = now - capturedAt;
    if (!Number.isFinite(capturedAt) || !Number.isFinite(now) || age < 0 || age >= MAX_POSE_AGE_MS) return false;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onExpire();
    }, MAX_POSE_AGE_MS - age);
    return true;
  }

  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

export class TrackingObservationProcessor {
  private calibration = new NeutralCalibration();
  private wasAway = false;

  reset(): void {
    this.calibration.reset();
    this.wasAway = false;
  }

  invalidate(): Observation {
    if (!this.calibration.baseline) this.calibration.reset();
    return {
      status: this.calibration.baseline ? 'tracking' : 'calibrating',
      pose: 'unknown', progress: this.calibration.progress, orientation: null,
      message: 'Waiting for a fresh camera observation. Playback assistance is temporarily paused.',
    };
  }

  observe(result: TrackingResult, sensitivity: Sensitivity): Observation {
    const orientation = result.faceCount === 1 && result.matrix ? orientationFromMatrix(result.matrix) : null;
    if (!orientation) {
      if (!this.calibration.baseline) this.calibration.reset();
      return {
        status: this.calibration.baseline ? 'tracking' : 'calibrating',
        pose: result.faceCount === 0 ? 'absent' : 'unknown',
        progress: this.calibration.progress,
        orientation: null,
        message: result.faceCount === 0 ? 'No face found. Move into the camera view.'
          : result.faceCount > 1 ? 'More than one face is visible. Keep only your face in view.'
          : 'Head orientation is uncertain. Face the camera in good light.',
      };
    }

    this.calibration.add(orientation, result.timestamp);
    const baseline = this.calibration.baseline;
    if (!baseline) return {
      status: 'calibrating', pose: 'unknown', progress: this.calibration.progress, orientation,
      message: this.calibration.status === 'unstable'
        ? 'Your head moved. Face the lesson and hold still for two seconds.'
        : 'Face the lesson comfortably and hold still for two seconds.',
    };

    const threshold = { relaxed: 32, balanced: 24, sensitive: 16 }[sensitivity];
    const pose = classifyOrientation(orientation, baseline, this.wasAway, threshold);
    if (pose === 'away' || pose === 'facing') this.wasAway = pose === 'away';
    return {
      status: 'tracking', pose, progress: 1, orientation,
      message: pose === 'away' ? 'Your head is turned away from the lesson.' : 'Neutral position saved. Camera tracking is active.',
    };
  }
}

interface CameraOptions {
  onPose: (pose: PoseState, capturedAt?: number) => void;
  onReset: () => void;
  sensitivity: Sensitivity;
}

interface CameraView {
  status: CameraStatus;
  pose: PoseState;
  progress: number;
  message: string;
  orientation: Orientation | null;
}

interface CameraTracking extends CameraView {
  videoRef: RefObject<HTMLVideoElement | null>;
  start: () => Promise<void>;
  stop: () => void;
  recalibrate: () => void;
}

interface Session {
  stream: MediaStream | null;
  worker: Worker | null;
  listeners: Map<MediaStreamTrack, () => void>;
  captureTimer: number | null;
  initTimer: number | null;
  flightTimer: number | null;
  freshness: PoseFreshness | null;
  ready: boolean;
  inFlight: boolean;
  pendingTimestamp: number | null;
  lastCaptureAt: number;
  lastNewFrameAt: number;
  lastVideoTime: number;
}

type WorkerReply = { type: 'ready' } | { type: 'result' } & TrackingResult | { type: 'error'; message: string };
const offState: CameraView = {
  status: 'off', pose: 'unknown', progress: 0, orientation: null,
  message: 'Camera is off. Enable it when you are ready.',
};

function errorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Camera permission was denied. Allow camera access in your browser settings, then try again. Manual playback and simulation still work.';
    if (error.name === 'NotFoundError') return 'No camera was found. Connect a camera and try again, or use simulation.';
    if (error.name === 'NotReadableError' || error.name === 'AbortError') return 'The camera could not start. Close other apps using it, reconnect it, and try again.';
  }
  return error instanceof Error ? error.message : 'Camera tracking could not start. Try again or use simulation.';
}

export function useCameraTracking(options: CameraOptions): CameraTracking {
  const [view, setView] = useState<CameraView>(offState);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const processorRef = useRef<TrackingObservationProcessor | null>(null);
  if (!processorRef.current) processorRef.current = new TrackingObservationProcessor();
  const sessionRef = useRef<Session | null>(null);
  const generationRef = useRef(0);

  const release = useCallback(() => {
    generationRef.current++;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      if (session.captureTimer !== null) window.clearTimeout(session.captureTimer);
      if (session.initTimer !== null) window.clearTimeout(session.initTimer);
      if (session.flightTimer !== null) window.clearTimeout(session.flightTimer);
      session.freshness?.clear();
      session.worker?.terminate();
      for (const [track, listener] of session.listeners) track.removeEventListener('ended', listener);
      session.stream?.getTracks().forEach(track => track.stop());
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    processorRef.current!.reset();
  }, []);

  const resetPolicy = useCallback(() => {
    optionsRef.current.onReset();
    optionsRef.current.onPose('unknown');
  }, []);

  const stop = useCallback(() => {
    release();
    resetPolicy();
    setView(offState);
  }, [release, resetPolicy]);

  const fail = useCallback((generation: number, message: string) => {
    if (generationRef.current !== generation || !sessionRef.current) return;
    release();
    resetPolicy();
    setView({ status: 'error', pose: 'unknown', progress: 0, orientation: null, message });
  }, [release, resetPolicy]);

  const start = useCallback(async () => {
    release();
    resetPolicy();
    if (document.hidden) {
      setView({ ...offState, message: 'Return to this tab, then enable the camera again.' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') {
      setView({ ...offState, status: 'error', message: 'Camera tracking needs a desktop Chrome browser on HTTPS or localhost. You can still use manual playback and simulation.' });
      return;
    }

    const generation = generationRef.current;
    const session: Session = {
      stream: null, worker: null, listeners: new Map(),
      captureTimer: null, initTimer: null, flightTimer: null, freshness: null,
      ready: false, inFlight: false, pendingTimestamp: null,
      lastCaptureAt: 0, lastNewFrameAt: performance.now(), lastVideoTime: -1,
    };
    sessionRef.current = session;
    setView({ ...offState, status: 'loading', message: 'Waiting for camera permission and loading the local head-tracking model…' });
    const isCurrent = () => generationRef.current === generation && sessionRef.current === session;
    session.freshness = new PoseFreshness(() => {
      if (!isCurrent()) return;
      setView(processorRef.current!.invalidate());
      optionsRef.current.onPose('unknown');
    });

    const scheduleCapture = () => {
      if (!isCurrent()) return;
      session.captureTimer = window.setTimeout(() => { void capture(); }, Math.max(0, 100 - (performance.now() - session.lastCaptureAt)));
    };

    const capture = async () => {
      if (!isCurrent() || !session.ready || session.inFlight) return;
      const video = videoRef.current;
      const now = performance.now();
      if (!video || video.readyState < 2 || video.videoWidth === 0 || video.currentTime === session.lastVideoTime) {
        if (now - session.lastNewFrameAt >= 5_000) {
          fail(generation, 'The camera stopped providing frames. Reconnect it, then enable tracking again.');
          return;
        }
        session.lastCaptureAt = now;
        scheduleCapture();
        return;
      }

      session.inFlight = true;
      session.pendingTimestamp = now;
      session.lastCaptureAt = now;
      session.lastNewFrameAt = now;
      session.lastVideoTime = video.currentTime;
      session.flightTimer = window.setTimeout(() => {
        fail(generation, 'Head tracking stopped responding. Enable the camera again, or continue with manual playback.');
      }, 5_000);

      let bitmap: ImageBitmap | null = null;
      try {
        const scale = Math.min(1, 640 / video.videoWidth, 480 / video.videoHeight);
        bitmap = await createImageBitmap(video, {
          resizeWidth: Math.max(1, Math.round(video.videoWidth * scale)),
          resizeHeight: Math.max(1, Math.round(video.videoHeight * scale)),
          resizeQuality: 'low',
        });
        if (!isCurrent()) return;
        session.worker!.postMessage({ type: 'frame', bitmap, timestamp: now }, [bitmap]);
      } catch (error) {
        fail(generation, `The camera frame could not be processed. ${errorMessage(error)}`);
      } finally {
        // A transferred bitmap belongs to the worker; close also releases any untransferred bitmap.
        bitmap?.close();
      }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false,
      });
      if (!isCurrent()) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      session.stream = stream;
      if (stream.getVideoTracks().length === 0) throw new Error('The camera returned no video track. Reconnect it and try again.');
      for (const track of stream.getVideoTracks()) {
        const listener = () => fail(generation, 'The camera was disconnected. Reconnect it and enable tracking again.');
        session.listeners.set(track, listener);
        track.addEventListener('ended', listener);
        if (track.readyState === 'ended') throw new Error('The camera disconnected before tracking started. Reconnect it and try again.');
      }
      const video = videoRef.current;
      if (!video) throw new Error('The camera preview is unavailable. Reload the page and try again.');
      video.srcObject = stream;
      const worker = new Worker(new URL('./tracker.worker.ts', import.meta.url), { type: 'module' });
      session.worker = worker;
      session.initTimer = window.setTimeout(() => {
        fail(generation, 'The local head-tracking model took too long to load. Reload the page, or use simulation.');
      }, 30_000);
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        if (!isCurrent()) return;
        const reply = event.data;
        if (reply.type === 'error') {
          fail(generation, `Camera tracking is unavailable. ${reply.message} You can continue with manual playback or simulation.`);
        } else if (reply.type === 'ready' && !session.ready) {
          if (session.initTimer !== null) window.clearTimeout(session.initTimer);
          session.initTimer = null;
          session.ready = true;
          session.lastNewFrameAt = performance.now();
          setView({ ...offState, status: 'calibrating', message: 'Face the lesson comfortably and hold still for two seconds.' });
          scheduleCapture();
        } else if (reply.type === 'result' && session.inFlight && reply.timestamp === session.pendingTimestamp) {
          if (session.flightTimer !== null) window.clearTimeout(session.flightTimer);
          session.flightTimer = null;
          session.inFlight = false;
          session.pendingTimestamp = null;
          const fresh = session.freshness!.accept(reply.timestamp, performance.now());
          const observation = fresh
            ? processorRef.current!.observe(reply, optionsRef.current.sensitivity)
            : processorRef.current!.invalidate();
          setView(observation);
          optionsRef.current.onPose(observation.pose, reply.timestamp);
          scheduleCapture();
        }
      };
      worker.onerror = event => {
        event.preventDefault();
        fail(generation, 'The local head-tracking runtime could not start. Reload in desktop Chrome, or use simulation.');
      };
      worker.onmessageerror = () => fail(generation, 'The camera worker returned an unreadable result. Enable tracking again, or use simulation.');
      worker.postMessage({
        type: 'init',
        wasmBase: new URL(`${import.meta.env.BASE_URL}mediapipe/`, document.baseURI).href.replace(/\/$/, ''),
        modelUrl: new URL(`${import.meta.env.BASE_URL}models/face_landmarker.task`, document.baseURI).href,
      });
      await video.play();
    } catch (error) {
      fail(generation, errorMessage(error));
    }
  }, [fail, release, resetPolicy]);

  const recalibrate = useCallback(() => {
    resetPolicy();
    sessionRef.current?.freshness?.clear();
    processorRef.current!.reset();
    if (sessionRef.current?.ready) {
      setView({ ...offState, status: 'calibrating', message: 'Face the lesson comfortably and hold still for two seconds.' });
    }
  }, [resetPolicy]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && sessionRef.current) {
        stop();
        setView({ ...offState, message: 'Camera stopped while this tab was hidden. Enable it again when you return.' });
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      release();
    };
  }, [release, stop]);

  return { ...view, videoRef, start, stop, recalibrate };
}
