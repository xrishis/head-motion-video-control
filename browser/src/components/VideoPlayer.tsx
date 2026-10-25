import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Expand, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

function formatTime(value: number) {
  if (!Number.isFinite(value)) return '0:00';
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  src: string;
  poster?: string;
  onManual: (action?: 'play' | 'pause' | 'seek') => void;
  onMediaEvent: (event: 'play' | 'pause' | 'ended' | 'seeking') => void;
  assistantPaused: boolean;
}

export default function VideoPlayer({ videoRef, src, poster, onManual, onMediaEvent, assistantPaused }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setPlaying(false); setTime(0); setDuration(0); setError(''); }, [src]);

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    setError('');
    if (!video.paused) { onManual('pause'); video.pause(); return; }
    onManual('play');
    try { await video.play(); } catch { setError('Playback could not start. Try Play again, or choose another video.'); }
  };

  return <div className="player-region">
    <div className="video-frame" ref={frameRef}>
      <video
        ref={videoRef} src={src} poster={poster} preload="metadata" playsInline disablePictureInPicture
        aria-label="Practice lesson video"
        onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
        onTimeUpdate={() => setTime(videoRef.current?.currentTime ?? 0)}
        onPlay={() => { setPlaying(true); onMediaEvent('play'); }}
        onPause={() => { setPlaying(false); onMediaEvent('pause'); }}
        onEnded={() => { setPlaying(false); onMediaEvent('ended'); }}
        onSeeking={() => onMediaEvent('seeking')}
        onError={() => setError('This video could not be opened. Choose a browser-compatible MP4 or WebM file.')}
      />
      {!playing && !error && <button className="center-play" aria-label="Play lesson" onClick={() => void togglePlayback()}><Play size={35} fill="currentColor" strokeWidth={1.6} /></button>}
      {assistantPaused && !playing && <div className="assistant-pause-label"><Pause size={13} /> Paused while you look away</div>}
      <div className="video-controls">
        <button className="icon-button" aria-label={playing ? 'Pause video' : 'Play video'} onClick={() => void togglePlayback()}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
        <span className="video-time">{formatTime(time)} <span>/ {formatTime(duration)}</span></span>
        <input aria-label="Seek lesson" className="seek" type="range" min={0} max={Number.isFinite(duration) && duration > 0 ? duration : 60} step={.1} value={time} onChange={event => { onManual('seek'); if (videoRef.current) videoRef.current.currentTime = Number(event.target.value); setTime(Number(event.target.value)); }} />
        <button className="icon-button rewind" aria-label="Rewind 10 seconds" onClick={() => { onManual('seek'); if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10); }}><RotateCcw size={18} /></button>
        <button className="icon-button" aria-label={muted ? 'Unmute video' : 'Mute video'} onClick={() => { const next = !muted; setMuted(next); if (videoRef.current) videoRef.current.muted = next; }}>{muted ? <VolumeX size={20} /> : <Volume2 size={20} />}</button>
        <button className="icon-button" aria-label="Enter fullscreen" onClick={() => { void frameRef.current?.requestFullscreen().catch(() => setError('Fullscreen is unavailable in this browser.')); }}><Expand size={19} /></button>
      </div>
    </div>
    {error && <p role="alert" className="player-error">{error}</p>}
  </div>;
}
