import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Check, ChevronRight, FlaskConical, LockKeyhole, Pause, Play, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import Preferences from '../components/Preferences';
import type { PreferencesValue } from '../components/Preferences';
import { useCameraTracking } from '../tracking/useCameraTracking';
import { readCameraPermission, requestCameraPermission } from './cameraPermission';
import type { PoseState } from '../core/playbackPolicy';
import { CHANNEL, DEFAULT_SETTINGS, EXTENSION_VERSION, epochNow, normalizeSettings } from './protocol';
import type { ExtensionResponse, PanelRequest, TargetSession, VideoAction, VideoStatus } from './protocol';

type Mode = 'off' | 'camera' | 'simulation';
type WithoutChannel<T> = T extends unknown ? Omit<T, 'channel'> : never;
const poseLabels: Record<PoseState, string> = { facing: 'Facing the screen', away: 'Looking away', absent: 'No face detected', unknown: 'Tracking uncertain' };
const toPreferences = (settings: typeof DEFAULT_SETTINGS): PreferencesValue => ({ pauseDelay: settings.pauseDelayMs / 1000, returnDelay: settings.returnDelayMs / 1000, autoResume: settings.autoResume, sensitivity: settings.sensitivity });
async function request(message: WithoutChannel<PanelRequest>): Promise<ExtensionResponse> {
  try { return await chrome.runtime.sendMessage({ ...message, channel: CHANNEL }); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'The extension connection was interrupted. Reopen Stillpoint.' }; }
}

export default function PanelApp() {
  const [session, setSession] = useState<TargetSession | null>(null);
  const [videoStatus, setVideoStatus] = useState<VideoStatus | null>(null);
  const [preferences, setPreferences] = useState(toPreferences(DEFAULT_SETTINGS));
  const [mode, setMode] = useState<Mode>('off');
  const [simulatedPose, setSimulatedPose] = useState<PoseState>('facing');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [permissionPending, setPermissionPending] = useState(false);
  const permissionRef = useRef<AbortController | null>(null);
  const targetRef = useRef<TargetSession | null>(null);
  const modeRef = useRef<Mode>('off');
  const sequence = useRef(0);
  const simulatedRef = useRef<PoseState>('facing');
  const stopCameraRef = useRef<() => void>(() => {});

  const sendPose = useCallback((pose: PoseState, capturedAt: number) => {
    const target = targetRef.current;
    if (!target?.connected || modeRef.current === 'off') return;
    // A reopened panel remains monotonic relative to an existing page controller.
    sequence.current = Math.max(sequence.current + 1, Math.floor(epochNow() * 1000));
    void request({ type: 'POSE', token: target.token, observation: { pose, capturedAt, sequence: sequence.current } });
  }, []);
  const onCameraPose = useCallback((pose: PoseState, capturedAt?: number) => {
    if (modeRef.current !== 'camera') return;
    sendPose(pose, capturedAt !== undefined ? performance.timeOrigin + capturedAt : epochNow());
  }, [sendPose]);
  const resetTarget = useCallback(() => { void request({ type: 'STOP' }); }, []);
  const tracking = useCameraTracking({ onPose: onCameraPose, onReset: resetTarget, sensitivity: preferences.sensitivity });
  stopCameraRef.current = tracking.stop;

  const cancelPermission = useCallback(() => {
    permissionRef.current?.abort();
    permissionRef.current = null;
    setPermissionPending(false);
  }, []);

  useEffect(() => {
    // Closing/reloading an extension document does not run React unmount cleanup.
    const cancelOnUnload = () => permissionRef.current?.abort();
    window.addEventListener('pagehide', cancelOnUnload);
    window.addEventListener('beforeunload', cancelOnUnload);
    return () => {
      window.removeEventListener('pagehide', cancelOnUnload);
      window.removeEventListener('beforeunload', cancelOnUnload);
    };
  }, []);

  const applyResponse = useCallback((response: ExtensionResponse) => {
    if ('session' in response) {
      const target = response.session ?? null;
      if (target?.token !== targetRef.current?.token || !target?.connected) {
        cancelPermission();
        if (modeRef.current !== 'off') { modeRef.current = 'off'; setMode('off'); stopCameraRef.current(); }
        sequence.current = 0;
      }
      targetRef.current = target;
      setSession(target);
    }
    if ('status' in response) setVideoStatus(response.status ?? null);
  }, [cancelPermission]);

  useEffect(() => {
    let mounted = true;
    let polling = false;
    const port = chrome.runtime.connect({ name: 'stillpoint-panel' });
    void request({ type: 'GET_SESSION' }).then(response => {
      if (!mounted) return;
      applyResponse(response);
      if (response.settings) setPreferences(toPreferences(normalizeSettings(response.settings)));
    });
    const poll = async () => {
      if (!mounted || polling) return;
      polling = true;
      const response = await request({ type: 'GET_STATUS' });
      polling = false;
      if (mounted) applyResponse(response);
    };
    const timer = window.setInterval(() => void poll(), 500);
    void poll();
    const changed = (_changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'session') void poll(); };
    chrome.storage.onChanged.addListener(changed);
    return () => {
      mounted = false; window.clearInterval(timer); chrome.storage.onChanged.removeListener(changed);
      cancelPermission();
      modeRef.current = 'off'; void request({ type: 'STOP' }); port.disconnect();
    };
  }, [applyResponse, cancelPermission]);

  useEffect(() => {
    if (mode !== 'simulation') return;
    const timer = window.setInterval(() => sendPose(simulatedRef.current, epochNow()), 100);
    return () => window.clearInterval(timer);
  }, [mode, sendPose]);

  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) return;
      modeRef.current = 'off'; setMode('off'); tracking.stop(); void request({ type: 'STOP' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [tracking.stop]);

  const stop = () => { cancelPermission(); modeRef.current = 'off'; setMode('off'); tracking.stop(); void request({ type: 'STOP' }); };
  const startCamera = async () => {
    const target = targetRef.current;
    if (!target?.connected) { setError('Select your video tab and click the Stillpoint toolbar icon first.'); return; }
    if (permissionRef.current) return;
    const controller = new AbortController();
    permissionRef.current = controller;
    setError(''); setPermissionPending(true);
    modeRef.current = 'off'; setMode('off'); tracking.stop();
    try {
      const permission = await readCameraPermission();
      if (controller.signal.aborted) return;
      if (permission !== 'granted') await requestCameraPermission({ signal: controller.signal, parentWindowId: target.windowId });
      // Consent can arrive after cancellation, a tab change, or closing this panel.
      if (controller.signal.aborted || targetRef.current?.token !== target.token || !targetRef.current.connected) return;
      if (document.hidden) { setError('Camera access is allowed. Return to the video tab and click Enable camera to begin.'); return; }
      modeRef.current = 'camera'; setMode('camera'); void tracking.start();
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The camera permission window could not open. Try again.');
    } finally {
      if (permissionRef.current === controller) { permissionRef.current = null; setPermissionPending(false); }
    }
  };
  const startSimulation = () => {
    cancelPermission();
    modeRef.current = 'off'; tracking.stop();
    simulatedRef.current = 'facing'; setSimulatedPose('facing');
    modeRef.current = 'simulation'; setMode('simulation'); setError('');
  };
  const allowAndConnect = async () => {
    setBusy(true); setError('');
    try {
      const selected = targetRef.current;
      if (selected?.url && /^https?:/.test(selected.url)) {
        const granted = await chrome.permissions.request({ origins: [`${new URL(selected.url).origin}/*`] });
        if (!granted) { setError('Site access was not granted. You can still select a video tab with the toolbar icon.'); return; }
      }
      const response = await request({ type: 'CONNECT_ACTIVE' });
      applyResponse(response);
      if (!response.ok) setError(response.error ?? 'Select a normal video page and click the toolbar icon again.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Site permission could not be requested.'); }
    finally { setBusy(false); }
  };
  const control = async (action: VideoAction) => {
    const selected = targetRef.current;
    if (!selected?.connected) return;
    const response = await request({ type: 'TARGET_ACTION', token: selected.token, action });
    applyResponse(response);
    if (!response.ok) setError(response.error ?? 'Video control is unavailable on this page.');
  };
  const changePreferences = (value: PreferencesValue) => {
    setPreferences(value);
    void request({ type: 'SETTINGS', settings: normalizeSettings({ pauseDelayMs: value.pauseDelay * 1000, returnDelayMs: value.returnDelay * 1000, autoResume: value.autoResume, sensitivity: value.sensitivity }) });
  };

  const cameraVisible = mode === 'camera' && (tracking.status === 'tracking' || tracking.status === 'calibrating');
  const cameraLabel = permissionPending ? 'Waiting for camera permission…' : mode === 'simulation' ? 'Simulation mode' : mode === 'off' ? 'Camera off' : tracking.status === 'tracking' ? poseLabels[tracking.pose] : tracking.status === 'calibrating' ? 'Calibrating your position' : tracking.status === 'error' ? 'Camera unavailable' : tracking.status === 'off' ? 'Camera off' : 'Preparing your camera…';
  let host = '';
  try { host = session?.url ? new URL(session.url).hostname : ''; } catch { /* Unsupported URLs have no displayed host. */ }

  return <main className="extension-panel">
    <header className="extension-header"><a className="brand" href="https://xrishis.github.io/head-motion-video-control/" target="_blank" rel="noreferrer"><span className="brand-mark"><i /><i /></span><span>Stillpoint</span></a><span className="extension-version">Extension · {EXTENSION_VERSION}</span></header>
    <div className="extension-intro"><h1>Your video, at your pace.</h1><p>A little less clicking. A little more watching.</p></div>
    <section className="target-section" aria-labelledby="target-title">
      <div className="section-label"><h2 id="target-title">Selected video tab</h2><span className={`connection-dot ${session?.connected ? 'connected' : ''}`} /></div>
      <strong className="target-name">{session?.title || 'Select a video to get started'}</strong>
      {host && <span className="target-host">{host}</span>}
      <p className="target-message" role="status">{!session?.connected ? session?.message || 'Open a video page, then click the Stillpoint toolbar icon.' : videoStatus?.message || 'Connected. Looking for a video on this page…'}</p>
      <div className="target-controls"><button aria-label="Play selected video" onClick={() => void control('play')} disabled={!session?.connected || !videoStatus?.videoFound}><Play size={15} /> Play</button><button aria-label="Pause selected video" onClick={() => void control('pause')} disabled={!session?.connected || !videoStatus?.videoFound}><Pause size={15} /> Pause</button><button aria-label="Rewind selected video" onClick={() => void control('rewind')} disabled={!session?.connected || !videoStatus?.videoFound}><RotateCcw size={14} /> 10 sec</button></div>
      <button className="text-button allow-site" onClick={() => void allowAndConnect()} disabled={busy}>{busy ? 'Connecting…' : session?.connected ? 'Allow this site for reconnects' : 'Connect current tab'}<ChevronRight size={13} /></button>
      {videoStatus?.pending && <div className="extension-pending"><span>{videoStatus.pending === 'pause' ? 'Pausing in a moment…' : 'Getting ready to resume…'}</span><div className="progress-track"><i style={{ width: `${videoStatus.progress * 100}%` }} /></div></div>}
    </section>
    <section className="extension-camera" aria-labelledby="camera-heading">
      <h2 id="camera-heading">Your camera assistant</h2>
      <div className={`tracking-status ${cameraVisible || mode === 'simulation' ? 'live' : ''}`}><span />{cameraLabel}</div>
      <div className={`camera-preview ${cameraVisible ? 'has-camera' : ''}`}><video ref={tracking.videoRef} muted autoPlay playsInline aria-label="Local camera preview" className={cameraVisible ? '' : 'hidden-preview'} />{!cameraVisible && <div className="camera-placeholder">{mode === 'simulation' ? <FlaskConical size={31} strokeWidth={1.4} /> : tracking.status === 'error' ? <CameraOff size={34} strokeWidth={1.4} /> : <Camera size={35} strokeWidth={1.4} />}<p>{mode === 'simulation' ? 'A camera-free test drive' : 'Ready when you are'}</p></div>}{mode === 'camera' && tracking.status === 'calibrating' && <div className="calibration-overlay"><span>Face the screen and hold comfortably still.</span><div className="progress-track"><i style={{ width: `${tracking.progress * 100}%` }} /></div></div>}{cameraVisible && <span className="preview-label"><ShieldCheck size={11} /> On-device processing</span>}</div>
      {permissionPending ? <><p className="camera-guidance" role="status">Choose Allow in the camera permission window. You will return here automatically.</p><button className="button outline full" onClick={stop}>Cancel camera request</button></> : mode === 'off' || (mode === 'camera' && (tracking.status === 'error' || tracking.status === 'off')) ? <><button className="button primary full" onClick={() => void startCamera()} disabled={!session?.connected}>Enable camera</button><p className="camera-privacy">Camera images and landmarks stay on this device.</p><button className="button outline full" onClick={startSimulation} disabled={!session?.connected}>Try without a camera</button></> : <><button className="button primary full" onClick={stop}><CameraOff size={15} /> Stop assistance</button>{mode === 'camera' && <button className="text-button centered" onClick={tracking.recalibrate}><RefreshCw size={12} /> Recalibrate</button>}</>}
      {mode === 'simulation' && <div className="simulation-controls"><p className="simulation-disclaimer">Simulated direction · no camera</p><div className="pose-buttons">{(['facing', 'away', 'absent'] as const).map(pose => <button key={pose} aria-pressed={simulatedPose === pose} className={simulatedPose === pose ? 'selected' : ''} onClick={() => { simulatedRef.current = pose; setSimulatedPose(pose); }}>{pose === 'facing' ? 'Face screen' : pose === 'away' ? 'Look away' : 'Leave frame'}</button>)}</div></div>}
      {mode === 'camera' && tracking.message && tracking.status !== 'tracking' && <p className={tracking.status === 'error' ? 'camera-error' : 'camera-guidance'}>{tracking.message}</p>}
    </section>
    {error && <p role="alert" className="camera-error">{error}</p>}
    <Preferences value={preferences} onChange={changePreferences} />
    <details className="extension-help"><summary>Permissions & compatibility</summary><p>Start playback on the video page once, then use the assistant. Keep this panel open beside your video. Click the toolbar icon on a new tab to select it. Site access is optional and requested per site. Switching tabs, navigation, or closing the panel stops assistance.</p><p>Standard videos in the main page are supported. Embedded or custom players need individual testing. Live YouTube and Netflix playback are unverified. Protected browser pages cannot be controlled.</p><p><LockKeyhole size={12} /> The model is packaged with the extension. No camera or browsing data is uploaded. Saved preferences stay in this browser.</p></details>
    <p className="extension-footer"><Check size={12} /> Manual pauses stay paused.</p>
  </main>;
}
