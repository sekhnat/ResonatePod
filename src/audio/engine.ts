import { epInfo, getEp, setPlayer, trimOn, useStore, type State } from '../store';
import { platform } from '../platform';

/** Below this RMS level (~-42 dBFS) audio counts as silence for trimming. */
const SILENCE_RMS = 0.008;
const SILENCE_MS = 250;
const TRIM_RATE = 3;
const ANALYSE_MS = 50;

/**
 * Drives a single <audio> element from the store: loads the current episode
 * (the local file when downloaded, else the stream), mirrors play/pause, speed and
 * volume, reports time/duration/end back, trims silence, and publishes MediaSession
 * metadata so desktop media keys and MPRIS widgets work.
 */
export function startEngine() {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.preservesPitch = true;
  if (platform.canAnalyse) audio.crossOrigin = 'anonymous';

  const st = () => useStore.getState();
  let loadedKey: string | null = null;
  let pendingSeek: number | null = null;
  let trimming = false;

  const rate = (s: State) => (trimming && s.speed < TRIM_RATE ? TRIM_RATE : s.speed);

  function load(s: State) {
    loadedKey = s.cur;
    const info = epInfo(s, s.cur);
    if (!info) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
      return;
    }
    audio.src = platform.mediaUrl(getEp(s, info.key).file, info.ep.enclosureUrl);
    pendingSeek = s.pos;
    audio.load();
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
  setInterval(() => {
    const s = st();
    const info = epInfo(s, s.cur);
    const active = !!analyser && s.playing && !audio.paused && !!info && trimOn(s, info.show.id);
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
  }, ANALYSE_MS);

  useStore.subscribe(apply);
  apply(st());
  return audio;
}
