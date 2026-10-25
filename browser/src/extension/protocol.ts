import type { PolicySettings, PoseState } from '../core/playbackPolicy';

export const CHANNEL = 'stillpoint-extension-v1' as const;
export const MAX_SIGNAL_AGE_MS = 350;
export const EXTENSION_VERSION = '0.2.1';
export type Sensitivity = 'relaxed' | 'balanced' | 'sensitive';
export interface ExtensionSettings extends PolicySettings { sensitivity: Sensitivity }
export const DEFAULT_SETTINGS: ExtensionSettings = { pauseDelayMs: 2000, returnDelayMs: 1000, autoResume: false, sensitivity: 'balanced' };

export interface TargetSession {
  token: string;
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  connected: boolean;
  message: string;
}

export interface VideoStatus {
  connected: boolean;
  videoFound: boolean;
  paused: boolean;
  ownsPause: boolean;
  pending: 'pause' | 'resume' | null;
  progress: number;
  message: string;
  site: 'youtube' | 'netflix' | 'html5';
  videoCount: number;
}

export type VideoAction = 'play' | 'pause' | 'rewind';
export interface Observation { pose: PoseState; capturedAt: number; sequence: number }
export type ContentMessage =
  | { channel: typeof CHANNEL; type: 'ATTACH'; token: string; settings: ExtensionSettings }
  | { channel: typeof CHANNEL; type: 'OBSERVE'; token: string; observation: Observation }
  | { channel: typeof CHANNEL; type: 'CONFIGURE'; token: string; settings: ExtensionSettings }
  | { channel: typeof CHANNEL; type: 'CONTROL'; token: string; action: VideoAction }
  | { channel: typeof CHANNEL; type: 'RESET'; token: string }
  | { channel: typeof CHANNEL; type: 'STATUS'; token: string };

export type PanelRequest =
  | { channel: typeof CHANNEL; type: 'GET_SESSION' }
  | { channel: typeof CHANNEL; type: 'CONNECT_ACTIVE' }
  | { channel: typeof CHANNEL; type: 'GET_STATUS' }
  | { channel: typeof CHANNEL; type: 'STOP' }
  | { channel: typeof CHANNEL; type: 'SETTINGS'; settings: ExtensionSettings }
  | { channel: typeof CHANNEL; type: 'POSE'; token: string; observation: Observation }
  | { channel: typeof CHANNEL; type: 'TARGET_ACTION'; token: string; action: VideoAction };

export interface ExtensionResponse { ok: boolean; session?: TargetSession | null; status?: VideoStatus | null; settings?: ExtensionSettings; error?: string }
export const epochNow = (): number => performance.timeOrigin + performance.now();

export function validObservation(value: unknown): value is Observation {
  if (!value || typeof value !== 'object') return false;
  const observation = value as Partial<Observation>;
  return ['facing', 'away', 'absent', 'unknown'].includes(observation.pose ?? '') && Number.isFinite(observation.capturedAt) && Number.isSafeInteger(observation.sequence) && observation.sequence! >= 0;
}

export function normalizeSettings(value: unknown): ExtensionSettings {
  const input = value && typeof value === 'object' ? value as Partial<ExtensionSettings> : {};
  const bounded = (candidate: unknown, min: number, max: number, fallback: number) => typeof candidate === 'number' && Number.isFinite(candidate) ? Math.min(max, Math.max(min, candidate)) : fallback;
  return {
    pauseDelayMs: bounded(input.pauseDelayMs, 1000, 5000, 2000),
    returnDelayMs: bounded(input.returnDelayMs, 500, 3000, 1000),
    autoResume: input.autoResume === true,
    sensitivity: input.sensitivity === 'relaxed' || input.sensitivity === 'sensitive' ? input.sensitivity : 'balanced',
  };
}
