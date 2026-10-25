import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Camera, CameraOff, Check, ChevronRight, CircleHelp, FlaskConical, Focus, LockKeyhole, Pause, RefreshCw, ShieldCheck, X } from 'lucide-react';
import VideoPlayer from './components/VideoPlayer';
import Preferences from './components/Preferences';
import type { PreferencesValue } from './components/Preferences';
import { MAX_POSE_AGE_MS, useCameraTracking } from './tracking/useCameraTracking';
import { usePlaybackAssistant } from './hooks/usePlaybackAssistant';
import type { PoseState } from './core/playbackPolicy';

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const DEFAULTS: PreferencesValue = { pauseDelay: 2, returnDelay: 1, autoResume: false, sensitivity: 'balanced' };
const labels: Record<PoseState, string> = { facing: 'Facing the screen', away: 'Looking away', absent: 'No face detected', unknown: 'Tracking uncertain' };
const NOTES = [
  { title: 'Settle into your natural position', detail: 'Place your webcam near the top of your screen. Sit comfortably with your whole face visible, in even lighting.' },
  { title: 'Enable the assistant and calibrate', detail: 'Choose Enable camera. Face the screen and hold still for about two seconds. Your camera is processed locally; video and face landmarks are not uploaded.' },
  { title: 'Turn away, then come back', detail: 'Play the lesson and look to the side for your chosen delay. Enable automatic resume if you want to continue on return. Manual pauses always stay paused.' },
];

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const objectUrl = useRef<string | null>(null);
  const [source, setSource] = useState(asset('demo/lesson.mp4'));
  const [fileName, setFileName] = useState('Your practice lesson');
  const [preferences, setPreferences] = useState(DEFAULTS);
  const [mode, setMode] = useState<'off' | 'camera' | 'simulation'>('off');
  const [simulatedPose, setSimulatedPose] = useState<PoseState>('facing');
  const [snoozed, setSnoozed] = useState(false);
  const [tab, setTab] = useState<'notes' | 'activity'>('notes');
  const [expandedNote, setExpandedNote] = useState<number | null>(null);
  const [help, setHelp] = useState(false);
  const [fileError, setFileError] = useState('');
  const [activity, setActivity] = useState<{ id: number; text: string; time: string }[]>([]);
  const [cameraPose, setCameraPose] = useState<PoseState>('unknown');
  const cameraObservation = useRef<{ pose: PoseState; validUntil: number }>({ pose: 'unknown', validUntil: 0 });
  const resetRef = useRef<() => void>(() => {});
  const dialogRef = useRef<HTMLDialogElement>(null);
  const addActivity = useCallback((text: string) => setActivity(previous => [{ id: Date.now() + Math.random(), text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, ...previous].slice(0, 30)), []);
  const onCameraPose = useCallback((pose: PoseState, capturedAt?: number) => {
    cameraObservation.current = { pose, validUntil: capturedAt !== undefined && Number.isFinite(capturedAt) ? capturedAt + MAX_POSE_AGE_MS : 0 };
    setCameraPose(pose);
  }, []);
  const getFreshCameraPose = useCallback((now: number): PoseState => now < cameraObservation.current.validUntil ? cameraObservation.current.pose : 'unknown', []);
  const onCameraReset = useCallback(() => resetRef.current(), []);
  const tracking = useCameraTracking({ onPose: onCameraPose, onReset: onCameraReset, sensitivity: preferences.sensitivity });
  // A sensitivity change also invalidates time accumulated under the previous threshold.
  const settings = useMemo(() => ({ pauseDelayMs: preferences.pauseDelay * 1000, returnDelayMs: preferences.returnDelay * 1000, autoResume: preferences.autoResume, sensitivity: preferences.sensitivity }), [preferences.pauseDelay, preferences.returnDelay, preferences.autoResume, preferences.sensitivity]);
  const active = !snoozed && (mode === 'simulation' || (mode === 'camera' && tracking.status === 'tracking'));
  const pose = mode === 'simulation' ? simulatedPose : cameraPose;
  const playback = usePlaybackAssistant(videoRef, settings, active, pose, source, addActivity, mode === 'camera' ? getFreshCameraPose : undefined);
  resetRef.current = playback.reset;

  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);
  useEffect(() => { if (help) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [help]);

  const disable = () => {
    tracking.stop();
    setMode('off');
    setSnoozed(false);
    playback.reset();
    addActivity('Assistant disabled. Playback remains under your control.');
  };
  const enableCamera = () => {
    setMode('camera'); setSnoozed(false); playback.reset();
    addActivity('Camera requested by you. Preparing local tracking.');
    void tracking.start();
  };
  const enableSimulation = () => {
    tracking.stop(); setMode('simulation'); setSimulatedPose('facing'); setSnoozed(false); playback.reset();
    addActivity('Simulation enabled. No camera permission is requested.');
  };
  const changeSource = (next: string, title: string) => {
    playback.manualAction('pause'); videoRef.current?.pause(); playback.reset();
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
    setSource(next); setFileName(title); setFileError('');
    addActivity('Lesson changed. Automatic resume ownership was reset.');
  };
  const cameraVisible = mode === 'camera' && (tracking.status === 'calibrating' || tracking.status === 'tracking');
  const status = mode === 'simulation' ? (snoozed ? 'Simulation snoozed' : 'Simulation mode') : mode === 'off' || tracking.status === 'off' ? 'Camera off' : tracking.status === 'error' ? 'Camera unavailable' : tracking.status === 'loading' ? 'Preparing your camera…' : tracking.status === 'calibrating' ? 'Calibrating your position' : snoozed ? 'Assistant snoozed' : labels[pose];

  return <>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="./" aria-label="Stillpoint home"><span className="brand-mark"><i /><i /></span><span>Stillpoint</span></a>
      <span className="brand-divider" /><span className="brand-subtitle">Hands-free learning</span>
      <div className="header-actions"><button className="button outline compact" onClick={() => setHelp(true)}>How it works</button><span className="privacy-header"><LockKeyhole size={15} />Camera stays on your device</span></div>
    </div></header>
    <main className="workspace">
      <section className="intro"><h1>A little less clicking. A little more learning.</h1><p>Your lesson pauses when you turn away. Pick up right where you left off.</p></section>
      <div className="workspace-grid">
        <section className="lesson-column" aria-label="Practice lesson">
          <VideoPlayer videoRef={videoRef} src={source} poster={fileName === 'Your practice lesson' ? asset('demo/poster.svg') : undefined} onManual={playback.manualAction} onMediaEvent={playback.mediaEvent} assistantPaused={playback.ownsPause} />
          <div className="lesson-title"><div><h2>{fileName}</h2><p>{fileName === 'Your practice lesson' ? 'A 60-second silent clip to try the controls.' : 'Local video · stays in this browser'}</p></div><button className="button outline" onClick={() => fileRef.current?.click()}>Open your video <ArrowUpRight size={16} /></button></div>
          <input ref={fileRef} className="visually-hidden" aria-label="Choose a local video" type="file" accept="video/*,.mp4,.webm,.mov" onChange={event => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (!(file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name))) { setFileError('Choose a video file, such as MP4 or WebM.'); event.target.value = ''; return; }
            const url = URL.createObjectURL(file); changeSource(url, file.name); objectUrl.current = url; event.target.value = '';
          }} />
          {fileError && <p role="alert" className="player-error">{fileError}</p>}
          {fileName !== 'Your practice lesson' && <button className="text-button sample-return" onClick={() => changeSource(asset('demo/lesson.mp4'), 'Your practice lesson')}><RefreshCw size={13} /> Back to sample lesson</button>}
          <div className="lesson-tabs" role="tablist" aria-label="Lesson details"><button id="notes-tab" role="tab" aria-selected={tab === 'notes'} aria-controls="notes-panel" onClick={() => setTab('notes')}>Lesson notes</button><button id="activity-tab" role="tab" aria-selected={tab === 'activity'} aria-controls="activity-panel" onClick={() => setTab('activity')}>Session activity{activity.length > 0 && <span className="activity-count">{activity.length}</span>}</button></div>
          {tab === 'notes' ? <div id="notes-panel" role="tabpanel" aria-labelledby="notes-tab" className="notes-list">{NOTES.map((note, index) => <div className="note" key={note.title}><button aria-expanded={expandedNote === index} onClick={() => setExpandedNote(expandedNote === index ? null : index)}><span className="step-number">{index + 1}</span><span>{note.title}</span><ChevronRight size={18} className={expandedNote === index ? 'rotated' : ''} /></button>{expandedNote === index && <p>{note.detail}</p>}</div>)}</div> : <div id="activity-panel" role="tabpanel" aria-labelledby="activity-tab" className="activity-list">{activity.length ? activity.map(item => <div key={item.id}><span className="activity-dot" /><p>{item.text}</p><time>{item.time}</time></div>) : <div className="activity-empty"><Focus size={22} /><p>Your session activity will appear here.</p><span>Events stay in memory and clear when you reload.</span></div>}</div>}
        </section>
        <aside className="assistant-panel" aria-labelledby="assistant-title">
          <h2 id="assistant-title">Your learning assistant</h2>
          <div className={`tracking-status ${active ? 'live' : ''}`} role="status"><span />{status}</div>
          <div className={`camera-preview ${cameraVisible ? 'has-camera' : ''}`}>
            <video ref={tracking.videoRef} muted playsInline autoPlay className={cameraVisible ? '' : 'hidden-preview'} aria-label="Local camera preview" />
            {!cameraVisible && <div className="camera-placeholder">{mode === 'simulation' ? <FlaskConical size={34} strokeWidth={1.3} /> : tracking.status === 'error' ? <CameraOff size={34} strokeWidth={1.3} /> : <Camera size={38} strokeWidth={1.3} />}<p>{mode === 'simulation' ? 'A camera-free test drive' : tracking.status === 'loading' ? 'Loading local face tracking…' : tracking.status === 'error' ? 'Let’s get you set up' : 'Ready when you are'}</p></div>}
            {tracking.status === 'calibrating' && mode === 'camera' && <div className="calibration-overlay"><Focus size={23} /><span>Face the screen. Hold comfortably still.</span><div className="progress-track"><i style={{ width: `${tracking.progress * 100}%` }} /></div></div>}
            {cameraVisible && tracking.status === 'tracking' && <span className="preview-label"><ShieldCheck size={12} /> Processed on this device</span>}
          </div>
          {mode === 'simulation' ? <div className="simulation-controls"><p className="simulation-disclaimer">Simulated head direction · no camera</p><div className="pose-buttons">{(['facing', 'away', 'absent'] as const).map(value => <button key={value} className={simulatedPose === value ? 'selected' : ''} aria-pressed={simulatedPose === value} onClick={() => setSimulatedPose(value)}>{value === 'facing' ? 'Face screen' : value === 'away' ? 'Look away' : 'Leave frame'}</button>)}</div><button className="button primary full" onClick={enableCamera}><Camera size={16} /> Use my camera instead</button><button className="text-button centered" onClick={disable}>Exit simulation</button></div> : mode === 'camera' && tracking.status !== 'off' && tracking.status !== 'error' ? <div className="camera-actions"><button className="button primary full" onClick={() => { setSnoozed(!snoozed); playback.reset(); }}>{snoozed ? <PlayIcon /> : <Pause size={15} />}{snoozed ? 'Continue assistance' : 'Snooze assistant'}</button><div className="camera-secondary"><button className="text-button" onClick={() => { setSnoozed(false); tracking.recalibrate(); }} disabled={tracking.status === 'loading'}><RefreshCw size={13} /> Recalibrate</button><button className="text-button" onClick={disable}><CameraOff size={13} /> Disable</button></div></div> : <><button className="button primary full" onClick={enableCamera}>{tracking.status === 'error' ? 'Try camera again' : 'Enable camera'}</button><p className="camera-privacy">Camera processing happens on this device.</p><button className="button outline full" onClick={enableSimulation}>Try without a camera</button></>}
          {mode === 'camera' && (tracking.status === 'error' || tracking.status === 'off') && tracking.message && <p role="alert" className="camera-error">{tracking.message}</p>}
          {mode === 'camera' && tracking.status === 'calibrating' && <p className="camera-guidance" aria-live="polite">{tracking.message}</p>}
          {active && <div className="assistant-feedback" aria-live="polite"><span>{playback.pending === 'pause' ? 'Pausing in a moment…' : playback.pending === 'resume' ? 'Getting ready to resume…' : playback.notice}</span>{playback.pending && <div className="progress-track"><i style={{ width: `${playback.progress * 100}%` }} /></div>}</div>}
          <Preferences value={preferences} onChange={setPreferences} />
        </aside>
      </div>
    </main>
    <footer><Check size={13} />You are always in control. Manual pauses stay paused.</footer>
    <dialog ref={dialogRef} className="help-dialog" onCancel={() => setHelp(false)} onClick={event => { if (event.target === dialogRef.current) setHelp(false); }}>
      <div className="dialog-title"><span className="dialog-icon"><CircleHelp size={23} /></span><button className="icon-button" aria-label="Close help" onClick={() => setHelp(false)}><X size={20} /></button></div>
      <h2>Learn at your own pace.</h2><p>Stillpoint uses your head direction as a playback preference. It does not measure attention or understanding.</p>
      <ol><li>Play the sample lesson or open a local video.</li><li>Enable the camera, then face the screen for calibration.</li><li>Turn away for the selected delay to pause. Automatic resume is optional.</li></ol>
      <div className="privacy-note"><LockKeyhole size={19} /><p>Camera images and face landmarks stay on this device. The app loads its model and lesson files from its host; it has no analytics service. Local videos are never uploaded.</p></div>
      <p className="dialog-small">Camera unavailable? Use the clearly labelled simulation. When you leave this tab, tracking stops and playback pauses. Press Play yourself after returning.</p>
      <button className="button primary full" onClick={() => setHelp(false)}>Got it</button>
    </dialog>
  </>;
}

function PlayIcon() { return <ChevronRight size={16} />; }
