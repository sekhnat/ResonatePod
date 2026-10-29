import { shallow } from 'zustand/shallow';
import { epInfo, getEp, setPlayer, trimOn, useStore, type State } from '../store';
import { platform } from '../platform';
import { getPlayhead } from '../playhead';

/** Below this RMS level (~-42 dBFS) audio counts as silence for trimming. */
const SILENCE_RMS = 0.008;
const SILENCE_MS = 250;
const TRIM_RATE = 3;
const ANALYSE_MS = 50;

// ---- where the picture goes for video podcasts ----
// The media element lives in a hidden host; a visible view borrows it while mounted.
// Moving a playing element within the document doesn't interrupt playback.
let media: HTMLVideoElement | null = null;
let host: HTMLElement | null = null;
const views: HTMLElement[] = [];

function placeMedia() {
  if (!media) return;
  const target = views[views.length - 1] ?? host;
  if (target && media.parentElement !== target) target.appendChild(media);
  media.style.display = views.length ? 'block' : 'none';
}

export function attachVideo(el: HTMLElement) {
  if (!views.includes(el)) views.push(el);
  placeMedia();
}

export function detachVideo(el: HTMLElement) {
  const i = views.indexOf(el);
  if (i >= 0) views.splice(i, 1);
  placeMedia();
}

/**
 * Drives a single media element from the store: loads the current episode
 * (the local file when downloaded, else the stream), mirrors play/pause, speed and
 * volume, reports time/duration/end back, trims silence, and publishes MediaSession
 * metadata so desktop media keys and MPRIS widgets work. It's a <video> element so
 * video podcasts have a picture; audio-only files play the same way.
 */
export function startEngine() {
  const audio = document.createElement('video');
  audio.preload = 'auto';
  audio.preservesPitch = true;
  audio.playsInline = true;
  audio.setAttribute('aria-label', 'Episode video');
  if (platform.canAnalyse) audio.crossOrigin = 'anonymous';
  Object.assign(audio.style, { width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'none' });
  host = document.createElement('div');
  host.hidden = true;
  document.body.appendChild(host);
  media = audio;
  placeMedia();

  const st = () => useStore.getState();
  let loadedKey: string | null = null;
  /** The local file the element is playing, if any (undefined when streaming). */
  let loadedFile: string | undefined;
  let pendingSeek: number | null = null;
  let trimming = false;

  const rate = (s: State) => (trimming && s.speed < TRIM_RATE ? TRIM_RATE : s.speed);

  function load(s: State, resumeAt?: number) {
    loadedKey = s.cur;
    const info = epInfo(s, s.cur);
    loadedFile = info ? getEp(s, info.key).file : undefined;
    if (!info) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
      if (s.video) useStore.setState({ video: false });
      return;
    }
    audio.src = platform.mediaUrl(loadedFile, info.ep.enclosureUrl);
    pendingSeek = resumeAt ?? getPlayhead();
    audio.load();
    if (resumeAt != null) return;
    if (s.video) useStore.setState({ video: false });
    if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
      const img = info.ep.imageUrl ?? info.show.imageUrl;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: info.title, artist: info.show.title, album: info.show.author,
        artwork: img ? [{ src: img, sizes: '512x512' }] : [],
      });
    }
  }

  function apply(s: State) {
    if (!s.hydrated) return;
    if (s.cur !== loadedKey) load(s);
    // The local file moved or was deleted under us: pick up where we were from the new source.
    else if (s.cur && loadedFile && getEp(s, s.cur).file !== loadedFile) load(s, audio.currentTime);
    if (!s.cur) return;
    const r = rate(s);
    if (audio.playbackRate !== r) audio.playbackRate = r;
    const vol = s.muted ? 0 : s.volume;
    if (audio.volume !== vol) audio.volume = vol;
    if (s.playing && audio.paused) {
      void ctx?.resume();
      audio.play().catch((err: Error) => { if (err.name !== 'AbortError') s.onPlayError(err.message); });
    } else if (!s.playing && !audio.paused) {
      audio.pause();
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s.playing ? 'playing' : 'paused';
  }

  audio.addEventListener('loadedmetadata', () => {
    if (pendingSeek != null && pendingSeek > 0) audio.currentTime = Math.min(pendingSeek, audio.duration || pendingSeek);
    pendingSeek = null;
    st().onDuration(audio.duration);
    const video = audio.videoWidth > 0;
    if (st().video !== video) useStore.setState({ video });
  });
  let lastPosState = 0;
  audio.addEventListener('timeupdate', () => {
    if (pendingSeek != null) return;
    st().onTime(audio.currentTime);
    const now = Date.now();
    if ('mediaSession' in navigator && now - lastPosState > 1000 && Number.isFinite(audio.duration)) {
      lastPosState = now;
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate }); } catch { /* ignore */ }
    }
  });
  audio.addEventListener('ended', () => st().onEnded());
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    const e = audio.error;
    st().onPlayError(e?.code === 4 ? 'the format isn’t supported or the file couldn’t be reached' : e?.message || 'network error');
  });

  setPlayer({
    seek(pos) {
      if (audio.readyState > 0) audio.currentTime = pos;
      else pendingSeek = pos;
    },
  });

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => { if (!st().playing) st().togglePlay(); }],
      ['pause', () => { if (st().playing) st().togglePlay(); }],
      ['seekbackward', () => st().skipBack()],
      ['seekforward', () => st().skipFwd()],
      ['seekto', (d) => { if (d.seekTime != null) st().seek(d.seekTime); }],
      ['previoustrack', () => st().prevChapter()],
      ['nexttrack', () => st().nextChapter()],
    ];
    for (const [a, h] of handlers) { try { ms.setActionHandler(a, h); } catch { /* unsupported action */ } }
  }

  // ---- silence trim ----
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  if (platform.canAnalyse && typeof AudioContext !== 'undefined') {
    ctx = new AudioContext();
    const src = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    analyser.connect(ctx.destination);
  }
  const buf = new Float32Array(2048);
  let silentMs = 0;
  let saved = 0;
  // Whether the current show wants trimming, worked out again only when something it depends on changes.
  let wanted: { cur: string | null; shows: State['shows']; ovr: State['ovr']; tg: State['tg']; on: boolean } | null = null;
  const trimWanted = (s: State) => {
    if (!wanted || wanted.cur !== s.cur || wanted.shows !== s.shows || wanted.ovr !== s.ovr || wanted.tg !== s.tg) {
      const info = epInfo(s, s.cur);
      wanted = { cur: s.cur, shows: s.shows, ovr: s.ovr, tg: s.tg, on: !!info && trimOn(s, info.show.id) };
    }
    return wanted.on;
  };
  function tick() {
    const s = st();
    const active = s.playing && !audio.paused && trimWanted(s);
    if (!active) {
      silentMs = 0;
      if (trimming) { trimming = false; audio.playbackRate = s.speed; }
      return;
    }
    analyser!.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    silentMs = rms < SILENCE_RMS ? silentMs + ANALYSE_MS : 0;
    const want = silentMs >= SILENCE_MS;
    if (want !== trimming) { trimming = want; audio.playbackRate = rate(s); }
    if (trimming && s.speed < TRIM_RATE) saved += (ANALYSE_MS / 1000) * (TRIM_RATE / s.speed - 1);
    if (saved >= 1) { s.addTrimSaved(saved); saved = 0; }
  }
  // Only listen while something is playing and the show wants its silences skipped: a paused player has none to skip,
  // and for a show with trimming off the timer would wake 20 times a second to do nothing.
  let analyseTimer: ReturnType<typeof setInterval> | null = null;
  function stopAnalyser() {
    if (analyseTimer) { clearInterval(analyseTimer); analyseTimer = null; }
    silentMs = 0;
    if (trimming) { trimming = false; audio.playbackRate = st().speed; }
  }
  function syncAnalyser() {
    const s = st();
    if (analyser && s.playing && !audio.paused && trimWanted(s)) {
      if (!analyseTimer) analyseTimer = setInterval(tick, ANALYSE_MS);
    } else if (analyseTimer) {
      stopAnalyser();
    }
  }
  audio.addEventListener('play', syncAnalyser);
  for (const ev of ['pause', 'ended', 'emptied']) audio.addEventListener(ev, stopAnalyser);

  // Only what apply() acts on, so the rest of the store changing (progress, toasts, the screen) doesn't wake it.
  useStore.subscribe(
    (s) => ({ hydrated: s.hydrated, cur: s.cur, shows: s.shows, file: s.cur ? s.eps[s.cur]?.file : undefined, playing: s.playing, speed: s.speed, volume: s.volume, muted: s.muted }),
    () => apply(st()),
    { equalityFn: shallow },
  );
  // Whether the timer should run follows the same things trimWanted() reads, and whether it is playing.
  useStore.subscribe(
    (s) => ({ cur: s.cur, shows: s.shows, ovr: s.ovr, tg: s.tg, playing: s.playing }),
    syncAnalyser,
    { equalityFn: shallow },
  );
  apply(st());
  return audio;
}
