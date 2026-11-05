/** Small typed boundary around the official, lazily loaded player SDKs. No campaign data lives here. */
export type PlaybackSample = { seconds: number; duration: number; untracked?: boolean; ended?: boolean };
export type CampaignPlayer = { play: () => void; pause: () => void; destroy: () => void; sample: () => PlaybackSample };

type YouTubePlayer = { mute: () => void; playVideo: () => void; pauseVideo: () => void; destroy: () => void; getCurrentTime: () => number; getDuration: () => number; getPlayerState?: () => number };
type VimeoPlayer = { play: () => Promise<void>; pause: () => Promise<void>; destroy: () => Promise<void>; setMuted: (v: boolean) => Promise<boolean>; setLoop: (v: boolean) => Promise<boolean>; ready: () => Promise<void>; getEnded?: () => Promise<boolean>; getCurrentTime?: () => Promise<number>; getDuration?: () => Promise<number>; on: (event: string, handler: (data: PlaybackSample) => void) => void; off: (event: string) => void };
type PlayerWindow = Window & {
  YT?: { Player: new (element: HTMLElement, options: Record<string, unknown>) => YouTubePlayer };
  Vimeo?: { Player: new (element: HTMLIFrameElement) => VimeoPlayer };
  onYouTubeIframeAPIReady?: () => void;
};
const playerWindow = window as PlayerWindow;
let youtube: Promise<void> | undefined;
let vimeo: Promise<void> | undefined;

function loadScript(src: string, ready: () => boolean, youtubeReady = false): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ready()) { resolve(); return; }
    const script = document.createElement('script');
    const previous = playerWindow.onYouTubeIframeAPIReady;
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      script.onload = null; script.onerror = null;
      if (youtubeReady && playerWindow.onYouTubeIframeAPIReady === onReady) playerWindow.onYouTubeIframeAPIReady = previous;
      if (error) { script.remove(); reject(error); } else resolve();
    };
    const onReady = () => { previous?.(); finish(); };
    // SDK loading deadline only: the already-rendered iframe keeps playing if this expires.
    const timeout = window.setTimeout(() => finish(new Error('Video player SDK timed out')), 15000);
    if (youtubeReady) playerWindow.onYouTubeIframeAPIReady = onReady;
    script.async = true; script.src = src;
    script.onerror = () => finish(new Error('Video player SDK could not load'));
    script.onload = () => { if (ready()) finish(); };
    document.head.appendChild(script);
  });
}

export async function youtubeSdk() {
  youtube ??= loadScript('https://www.youtube.com/iframe_api', () => Boolean(playerWindow.YT?.Player), true).catch(error => { youtube = undefined; throw error; });
  await youtube;
  return playerWindow.YT!;
}
export async function vimeoSdk() {
  vimeo ??= loadScript('https://player.vimeo.com/api/player.js', () => Boolean(playerWindow.Vimeo?.Player)).catch(error => { vimeo = undefined; throw error; });
  await vimeo;
  return playerWindow.Vimeo!;
}

export async function createCampaignPlayer({ host, source, isPlaying, onReady, onEnded, onFailure, onController, isDisposed }: {
  host: HTMLElement;
  source: { type: 'youtube' | 'vimeo'; id: string; embedUrl: string };
  isPlaying: () => boolean;
  onReady: () => void;
  onEnded: () => void;
  onFailure: () => void;
  onController: (player: CampaignPlayer) => void;
  isDisposed: () => boolean;
}) {
  // Restore the working iframe-first path: SDK failure must not remove a playable embed.
  const iframe = document.createElement('iframe');
  const url = new URL(source.embedUrl);
  url.searchParams.set('autoplay', isPlaying() ? '1' : '0');
  url.searchParams.set('loop', '0'); url.searchParams.delete('playlist');
  if (source.type === 'youtube') { url.searchParams.set('enablejsapi', '1'); url.searchParams.set('origin', location.origin); }
  iframe.src = url.href; iframe.title = 'Campaign video'; iframe.tabIndex = -1;
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture'; iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.onload = () => { if (!isDisposed() && iframe.src !== 'about:blank') onReady(); };
  host.appendChild(iframe);
  onController({
    play: () => { if (iframe.src === 'about:blank') { url.searchParams.set('autoplay', '1'); iframe.src = url.href; } },
    pause: () => { iframe.src = 'about:blank'; },
    sample: () => ({ seconds: 0, duration: 0, untracked: true }),
    destroy: () => { iframe.onload = null; iframe.remove(); },
  });
  if (source.type === 'youtube') {
    const sdk = await youtubeSdk().catch(() => null);
    if (!sdk || isDisposed()) return;
    if (iframe.src === 'about:blank') { url.searchParams.set('autoplay', isPlaying() ? '1' : '0'); iframe.src = url.href; }
    const player = new sdk.Player(iframe, {
      events: {
        onReady: () => { if (!isDisposed()) { player.mute(); if (player.getPlayerState?.() === 0) onEnded(); else if (isPlaying()) player.playVideo(); else player.pauseVideo(); } },
        onStateChange: (event: { data: number }) => { if (isDisposed()) return; if (event.data === 0) onEnded(); if (event.data === 1) { if (isPlaying()) onReady(); else player.pauseVideo(); } },
        onError: () => { if (!isDisposed()) onFailure(); },
        onAutoplayBlocked: () => { if (!isDisposed() && isPlaying()) onFailure(); },
      },
    });
    onController({
      play: () => { if (typeof player.playVideo === 'function') { player.mute(); player.playVideo(); } },
      pause: () => { if (typeof player.pauseVideo === 'function') player.pauseVideo(); },
      sample: () => ({ seconds: player.getCurrentTime?.() || 0, duration: player.getDuration?.() || 0, ended: player.getPlayerState?.() === 0 }),
      destroy: () => { iframe.onload = null; player.destroy(); },
    });
  } else {
    const sdk = await vimeoSdk().catch(() => null);
    if (!sdk || isDisposed()) return;
    if (iframe.src === 'about:blank') { url.searchParams.set('autoplay', isPlaying() ? '1' : '0'); iframe.src = url.href; }
    const player = new sdk.Player(iframe);
    let sample: PlaybackSample = { seconds: 0, duration: 0 };
    let completed = false;
    let hasPlayed = false;
    let checkingEnd = false;
    let lastEndCheck = 0;
    const fail = () => { if (!isDisposed()) onFailure(); };
    const play = () => { void player.play().catch(fail); };
    const pause = () => { void player.pause().catch(() => {}); };
    player.on('timeupdate', value => { sample = value; if (value.seconds > 0) hasPlayed = true; });
    player.on('ended', () => { completed = true; if (!isDisposed()) onEnded(); });
    player.on('playing', () => { hasPlayed = true; completed = false; if (!isDisposed()) { if (isPlaying()) onReady(); else pause(); } });
    player.on('error', fail);
    onController({ play, pause, sample: () => {
      // Progress metadata can change during loading; reaching that metadata value is
      // not itself an ended event. Use Vimeo's actual end state as the callback backup.
      if (hasPlayed && player.getEnded && !checkingEnd && performance.now() - lastEndCheck >= 1000) {
        checkingEnd = true; lastEndCheck = performance.now();
        void player.getEnded().then(value => { if (!isDisposed()) completed = value; }).catch(() => {}).finally(() => { checkingEnd = false; });
      }
      return { ...sample, ended: completed };
    }, destroy: () => { iframe.onload = null; ['timeupdate', 'ended', 'playing', 'error'].forEach(event => player.off(event)); void player.destroy().catch(() => {}); } });
    void player.ready().then(async () => {
      if (isDisposed()) return;
      await player.setLoop(false); await player.setMuted(true);
      if (isDisposed()) return;
      const [seconds, duration, isEnded] = await Promise.all([player.getCurrentTime?.(), player.getDuration?.(), player.getEnded?.()]);
      if (isDisposed()) return;
      if (seconds !== undefined && duration !== undefined) { sample = { seconds, duration }; if (seconds > 0) hasPlayed = true; }
      if (isEnded && hasPlayed) { completed = true; onEnded(); }
      else if (isPlaying()) play(); else pause();
    }).catch(fail);
  }
}
