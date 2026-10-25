import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { PlaybackPolicy } from '../core/playbackPolicy';
import type { PolicySettings, PoseState } from '../core/playbackPolicy';

export function usePlaybackAssistant(videoRef: RefObject<HTMLVideoElement | null>, settings: PolicySettings, active: boolean, pose: PoseState, source: string, onActivity: (message: string) => void, getFreshPose?: (now: number) => PoseState) {
  const policy = useRef(new PlaybackPolicy(settings));
  const inputs = useRef({ active, pose, onActivity, getFreshPose });
  inputs.current = { active, pose, onActivity, getFreshPose };
  const epoch = useRef(0);
  const expected = useRef<'play' | 'pause' | null>(null);
  const desiredPaused = useRef(true);
  const [view, setView] = useState({ ownsPause: false, pending: null as 'pause' | 'resume' | null, progress: 0 });
  const [notice, setNotice] = useState('You are in control.');

  const updateView = useCallback(() => {
    const next = policy.current.snapshot(performance.now());
    setView(previous => previous.ownsPause === next.ownsPause && previous.pending === next.pending && Math.abs(previous.progress - next.progress) < .015 ? previous : next);
  }, []);

  const reset = useCallback(() => {
    epoch.current += 1;
    expected.current = null;
    desiredPaused.current = videoRef.current?.paused ?? true;
    policy.current.reset();
    updateView();
  }, [updateView, videoRef]);

  const manualAction = useCallback((action?: 'play' | 'pause' | 'seek') => {
    epoch.current += 1;
    expected.current = null;
    desiredPaused.current = action === 'pause' ? true : action === 'play' ? false : (videoRef.current?.paused ?? true);
    policy.current.manualAction();
    setNotice(action === 'pause' ? 'Paused by you. It will stay paused.' : 'You are in control.');
    updateView();
  }, [updateView, videoRef]);

  const mediaEvent = useCallback((event: 'play' | 'pause' | 'ended' | 'seeking') => {
    if (event === 'ended') { reset(); return; }
    if (event === 'seeking') { manualAction('seek'); return; }
    if (expected.current === event) { expected.current = null; return; }
    manualAction(event);
  }, [manualAction, reset]);

  useEffect(() => { policy.current.configure(settings); updateView(); }, [settings, updateView]);
  useEffect(() => { reset(); setNotice('You are in control.'); }, [source, reset]);
  useEffect(() => { if (!active) reset(); }, [active, reset]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        manualAction('pause');
        videoRef.current?.pause();
        reset();
        setNotice('Paused while this tab was hidden. Press Play when you return.');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || !inputs.current.active || document.hidden || video.ended || video.readyState < 2 || video.seeking) return;
      const now = performance.now();
      // Check capture validity here as well as in UI timers: a long task can delay timer delivery.
      const currentPose = inputs.current.getFreshPose?.(now) ?? inputs.current.pose;
      const action = policy.current.observe(currentPose, now, video.paused);
      if (action === 'pause') {
        expected.current = 'pause';
        desiredPaused.current = true;
        video.pause();
        setNotice('Paused by your assistant. Take your time.');
        inputs.current.onActivity('Assistant paused the lesson after you looked away.');
      } else if (action === 'resume') {
        const requestEpoch = ++epoch.current;
        expected.current = 'play';
        desiredPaused.current = false;
        void video.play().then(() => {
          if (epoch.current !== requestEpoch && desiredPaused.current) { video.pause(); return; }
          if (epoch.current === requestEpoch) {
            setNotice('Welcome back. Your lesson is continuing.');
            inputs.current.onActivity('Assistant resumed its paused lesson.');
          }
        }).catch(() => {
          if (epoch.current !== requestEpoch) return;
          reset();
          setNotice('Your browser needs a click. Press Play to continue.');
        });
      }
      updateView();
    }, 100);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); epoch.current += 1; };
  }, [manualAction, reset, updateView, videoRef]);

  return { ...view, notice, reset, manualAction, mediaEvent };
}
