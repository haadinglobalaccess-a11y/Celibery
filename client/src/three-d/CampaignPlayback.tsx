import { useEffect, useRef, useState } from 'react';
import type { VideoSource } from '../lib/media';
import { createCampaignPlayer, type CampaignPlayer } from './campaignPlayers';

type Props = {
  source: VideoSource | null;
  poster?: string;
  playing: boolean;
  imageDurationMs: number;
  videoDurationMs: number;
  fallbackMs: number;
  onProgress: (fraction: number) => void;
  onEnd: () => void;
};

/** One clock per visit. Normal video timing uses player time; unavailable tracking is an explicit recovery path. */
export function CampaignPlayback(props: Props) {
  const callbacks = useRef(props); callbacks.current = props;
  const video = useRef<HTMLVideoElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<CampaignPlayer>();
  const failed = useRef(false);
  const ended = useRef(false);
  const imageElapsed = useRef(0);
  const waitingElapsed = useRef(0);
  const untrackedElapsed = useRef(0);
  const stalledElapsed = useRef(0);
  const lastSeconds = useRef(0);
  const started = useRef(false);
  const [showMedia, setShowMedia] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const fail = () => {
    if (failed.current) return;
    failed.current = true; imageElapsed.current = 0;
    video.current?.pause(); player.current?.pause();
    setHasFailed(true); setShowMedia(false); callbacks.current.onProgress(0);
  };
  const failRef = useRef(fail); failRef.current = fail;
  const source = props.source;

  useEffect(() => {
    if (!source || source.type === 'file' || !host.current) return;
    let disposed = false;
    void createCampaignPlayer({
      host: host.current, source,
      isPlaying: () => callbacks.current.playing && !failed.current,
      isDisposed: () => disposed,
      onReady: () => setShowMedia(true),
      onEnded: () => { ended.current = true; },
      onFailure: () => failRef.current(),
      onController: controller => { if (disposed) controller.destroy(); else player.current = controller; },
    }).catch(() => { if (!disposed) failRef.current(); });
    return () => { disposed = true; player.current?.destroy(); player.current = undefined; };
    // The owning hero rekeys this component whenever source or slide changes.
  }, []);

  useEffect(() => {
    if (failed.current) return;
    const native = video.current;
    if (props.playing) {
      if (native) { native.muted = true; void native.play().catch(error => { if (error.name !== 'AbortError') failRef.current(); }); }
      player.current?.play();
    } else { native?.pause(); player.current?.pause(); }
    return () => { native?.pause(); player.current?.pause(); };
  }, [props.playing]);

  useEffect(() => {
    if (!props.playing) return;
    let frame = 0;
    let previous = performance.now();
    let done = false;
    const finish = () => { done = true; callbacks.current.onProgress(1); callbacks.current.onEnd(); };
    const tick = (now: number) => {
      const dt = now - previous; previous = now;
      const current = callbacks.current;
      if (!source || failed.current) {
        imageElapsed.current += dt;
        const duration = Number.isFinite(current.imageDurationMs) && current.imageDurationMs > 0 ? current.imageDurationMs : 5000; // Invalid/missing configuration only.
        current.onProgress(Math.min(1, imageElapsed.current / duration));
        if (imageElapsed.current >= duration) finish();
      } else if (ended.current) finish();
      else {
        const sample = source.type === 'file'
          ? { seconds: video.current?.currentTime || 0, duration: video.current?.duration || 0, ended: video.current?.ended || false }
          : player.current?.sample() || { seconds: 0, duration: 0, untracked: true };
        // Verify actual player end state too, in case a completion event was missed.
        if ('ended' in sample && sample.ended) { finish(); return; }
        const finiteDuration = Number.isFinite(sample.duration) && sample.duration > 0;
        const configuredSeconds = Number.isFinite(current.videoDurationMs) && current.videoDurationMs > 0 ? current.videoDurationMs / 1000 : 0;
        const duration = configuredSeconds > 0 ? (finiteDuration ? Math.min(configuredSeconds, sample.duration) : configuredSeconds) : (finiteDuration ? sample.duration : 0);
        current.onProgress(duration > 0 ? Math.min(1, sample.seconds / duration) : 0);
        if (configuredSeconds > 0 && sample.seconds >= configuredSeconds) { finish(); return; }
        if (sample.seconds > 0) started.current = true;
        const untracked = 'untracked' in sample && sample.untracked;
        if (untracked) {
          // A blocked provider API cannot report the end. Skip after the saved recovery
          // window rather than freezing forever; do not pretend this is playback progress.
          untrackedElapsed.current += dt;
          // Tracking failures use only the separately configured recovery window,
          // never a guessed normal/custom playback duration or fabricated progress.
          if (untrackedElapsed.current >= current.fallbackMs) finish();
        } else {
          untrackedElapsed.current = 0;
          stalledElapsed.current = Math.abs(sample.seconds - lastSeconds.current) > 0.001 ? 0 : stalledElapsed.current + dt;
          lastSeconds.current = sample.seconds;
          // Only stalled samples trigger failure recovery; normal endpoints remain admin-controlled.
          if (started.current && stalledElapsed.current >= current.fallbackMs) failRef.current();
          // Zero mode, including unknown-duration video, waits for actual completion.
          if (!started.current) {
            waitingElapsed.current += dt;
            if (waitingElapsed.current >= current.fallbackMs) failRef.current();
          }
        }
      }
      if (!done) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [props.playing]);

  if (!source || hasFailed) return null;
  if (source.type === 'file') return <video ref={video} className={`campaign-video ${showMedia ? 'is-ready' : ''}`} src={source.url} poster={props.poster} muted playsInline preload="metadata" autoPlay={props.playing} onPlaying={() => setShowMedia(true)} onEnded={() => { ended.current = true; }} onError={fail} aria-hidden="true" />;
  return <div ref={host} className={`embed-cover campaign-video ${showMedia ? 'is-ready' : ''}`} aria-hidden="true" />;
}
