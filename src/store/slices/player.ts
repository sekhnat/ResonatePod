import type { EpisodeAction } from '../../../shared/gpodder';
import { parseJsonChapters, parseTranscript } from '../../../shared/meta';
import type { EpisodeInfo, EpisodeMeta } from '../../data';
import { SMALL_BODY_BYTES, platform } from '../../platform';
import { getPlayhead, setPlayhead } from '../../playhead';
import { chaptersOf, currentChapter, epInfo, getEp, introFor, sleepLabel, speedFor } from '../selectors';
import type { EpState, Slice } from '../types';

/** The audio engine, which the store seeks through. */
export interface Player { seek(pos: number): void }
let player: Player | null = null;
export const setPlayer = (p: Player | null) => { player = p; };

const SPEEDS = [1, 1.2, 1.5, 2];
const MAX_PENDING_ACTIONS = 5000;
const isoNow = () => new Date().toISOString().slice(0, 19);

/** Chapters from the feed's chapters file, else from inside the media file. */
async function loadChapters(info: EpisodeInfo, file: string | undefined) {
  const { chaptersUrl, inlineChapters, enclosureUrl } = info.ep;
  if (chaptersUrl) {
    const r = await platform.http(chaptersUrl, { maxBytes: SMALL_BODY_BYTES }).catch(() => null);
    const ch = r?.status === 200 ? (() => { try { return parseJsonChapters(r.text); } catch { return []; } })() : [];
    if (ch.length) return ch;
  }
  if (inlineChapters?.length) return undefined;
  return (await platform.embeddedChapters(file, enclosureUrl).catch(() => null)) ?? undefined;
}

export const createPlayerSlice: Slice<'play' | 'togglePlay' | 'seek' | 'skipBack' | 'skipFwd' | 'prevChapter' | 'nextChapter' | 'cycleSpeed' | 'setSpeed' | 'setVolume' | 'toggleMute' | 'setSleep' | 'tick' | 'onTime' | 'onDuration' | 'onEnded' | 'onPlayError' | 'addTrimSaved' | 'loadMeta' | 'checkpoint' | 'addToQueue' | 'removeFromQueue' | 'moveQueue' | 'clearQueue'> = (set, get) => {
  let lastChapterIdx = -1;
  let playStartedAt: number | null = null;

  /** Queues a gpodder play action for the current episode, when sync is set up. */
  const recordPlay = () => {
    const s = get();
    const info = epInfo(s, s.cur);
    const started = playStartedAt;
    playStartedAt = null;
    if (!info || !s.sync.server || started === null) return;
    const action: EpisodeAction = {
      podcast: info.show.feedUrl, episode: info.ep.enclosureUrl, action: 'play', timestamp: isoNow(),
      started: Math.floor(started), position: Math.floor(getPlayhead()), total: Math.floor(info.dur || getPlayhead()),
    };
    // A newer session of an episode replaces the older one, so a long offline spell stays small;
    // the cap is only a backstop for someone who plays thousands of different episodes without syncing.
    const sameEpisode = (a: EpisodeAction) => a.action === 'play' && a.podcast === action.podcast && a.episode === action.episode;
    set({ sync: { ...s.sync, pending: [...s.sync.pending.filter((a) => !sameEpisode(a)), action].slice(-MAX_PENDING_ACTIONS) } });
  };

  const saveCurPos = (): Record<string, EpState> => {
    const s = get();
    if (!s.cur) return s.eps;
    return { ...s.eps, [s.cur]: { ...getEp(s, s.cur), pos: getPlayhead(), lastPlayed: Date.now() } };
  };

  return {
    play: (key) => {
      const s = get();
      if (s.cur === key) { get().togglePlay(); set({ palette: false }); return; }
      const next = epInfo(s, key);
      if (!next) return;
      if (s.playing) recordPlay();
      const eps = saveCurPos();
      const st = getEp(s, key);
      let pos = st.played || (next.dur && st.pos >= next.dur - 5) ? 0 : st.pos;
      if (pos === 0) pos = introFor(s, next.show.id);
      lastChapterIdx = -1;
      playStartedAt = pos;
      setPlayhead(pos); // before `cur` changes, so the engine loads the episode at this position
      set({ eps, cur: key, playing: true, palette: false, speed: speedFor(s, next.show.id) });
      void get().loadMeta(key);
    },
    togglePlay: () => {
      const s = get();
      if (!s.cur) return;
      if (s.playing) { recordPlay(); set({ playing: false, eps: saveCurPos() }); }
      else { playStartedAt = getPlayhead(); set({ playing: true }); }
    },
    seek: (pos) => {
      const s = get();
      const cur = epInfo(s, s.cur);
      if (!cur) return;
      const p = Math.max(0, cur.dur ? Math.min(cur.dur, pos) : pos);
      setPlayhead(p);
      player?.seek(p);
    },
    skipBack: () => get().seek(getPlayhead() - get().sv.skip.back),
    skipFwd: () => get().seek(getPlayhead() + get().sv.skip.fwd),
    prevChapter: () => {
      const s = get();
      const cur = epInfo(s, s.cur);
      if (!cur) return;
      const ch = chaptersOf(s, cur);
      const pos = getPlayhead();
      const ci = currentChapter(ch, pos);
      get().seek(ch[Math.max(0, pos - ch[ci].at > 3 ? ci : ci - 1)].at);
    },
    nextChapter: () => {
      const s = get();
      const cur = epInfo(s, s.cur);
      if (!cur) return;
      const ch = chaptersOf(s, cur);
      const ci = currentChapter(ch, getPlayhead());
      if (ci < ch.length - 1) get().seek(ch[ci + 1].at);
    },
    // The next faster preset from wherever the speed is now (a show can set one that isn't a preset), wrapping to the slowest.
    cycleSpeed: () => set((s) => ({ speed: SPEEDS.find((p) => p > s.speed + 1e-9) ?? SPEEDS[0] })),
    setSpeed: (speed) => set({ speed, palette: false }),
    setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)), muted: false }),
    toggleMute: () => set((s) => ({ muted: !s.muted })),
    setSleep: (sleep) => {
      set({ sleep, menu: null, palette: false });
      if (sleep.mode !== 'off') get().toast(`Sleep timer: ${sleepLabel(sleep).toLowerCase()}`);
    },
    tick: () => {
      const s = get();
      if (!s.playing || s.sleep.mode !== 'timer') return;
      const remaining = s.sleep.remaining - 1;
      if (remaining > 0) set({ sleep: { ...s.sleep, remaining } });
      else { set({ sleep: { mode: 'off' } }); get().togglePlay(); }
    },
    onTime: (pos) => {
      const s = get();
      setPlayhead(pos);
      const cur = epInfo(s, s.cur);
      if (!cur) return;
      const ci = currentChapter(chaptersOf(s, cur), pos);
      if (s.sleep.mode === 'chapter' && lastChapterIdx >= 0 && ci !== lastChapterIdx && s.playing) {
        set({ sleep: { mode: 'off' } });
        get().togglePlay();
      }
      lastChapterIdx = ci;
    },
    onDuration: (dur) => {
      const s = get();
      const cur = epInfo(s, s.cur);
      if (!cur || !Number.isFinite(dur) || dur <= 0 || Math.abs(cur.dur - dur) < 2) return;
      const d = Math.round(dur);
      set({ shows: s.shows.map((sh) => (sh.id !== cur.show.id ? sh : { ...sh, eps: sh.eps.map((e) => (e.guid === cur.ep.guid ? { ...e, duration: d } : e)) })) });
    },
    onEnded: () => {
      const s = get();
      const cur = epInfo(s, s.cur);
      if (!cur) return;
      recordPlay();
      const now = Date.now();
      const eps = { ...s.eps, [cur.key]: { ...getEp(s, cur.key), played: true, pos: 0, playedAt: now, lastPlayed: now } };
      const queue = s.queue.filter((k) => k !== cur.key);
      set({ eps, queue });
      if (s.sleep.mode === 'episode' || !queue.length) {
        set({ playing: false, sleep: { mode: 'off' } });
      } else {
        get().play(queue[0]);
      }
    },
    onPlayError: (message) => {
      set({ playing: false });
      get().toast(`Can’t play this episode: ${message}`);
    },
    addTrimSaved: (sec) => set((s) => ({ trimPending: s.trimPending + sec })),
    loadMeta: async (key) => {
      const s = get();
      const info = epInfo(s, key);
      if (!info || s.meta[key]) return;
      const meta: EpisodeMeta = {};
      set({ meta: { ...get().meta, [key]: meta } });
      const { transcriptUrl, transcriptType } = info.ep;
      await Promise.all([
        loadChapters(info, getEp(s, key).file).then((ch) => { meta.chapters = ch; }),
        transcriptUrl && platform.http(transcriptUrl, { maxBytes: SMALL_BODY_BYTES }).then((r) => {
          const t = r.status === 200 ? parseTranscript(r.text, transcriptType) : null;
          meta.transcript = t?.lines ?? null;
          meta.transcriptTimed = t?.timed;
        }).catch(() => { meta.transcript = null; }),
      ]);
      if (get().meta[key] === meta) set({ meta: { ...get().meta, [key]: { ...meta } } });
    },
    checkpoint: () => {
      const s = get();
      if (s.trimPending > 0) set({ trimSaved: s.trimSaved + s.trimPending, trimPending: 0 });
      if (s.cur && Math.abs(getEp(s, s.cur).pos - getPlayhead()) >= 1) set({ eps: saveCurPos() });
    },
    addToQueue: (key) => {
      const s = get();
      const info = epInfo(s, key);
      if (!info) return;
      if (s.queue.includes(key)) { s.toast('Already in the queue'); return; }
      set({ queue: [...s.queue, key] });
      s.toast(`Added “${info.title}” to the queue`);
    },
    removeFromQueue: (key) => set((s) => ({ queue: s.queue.filter((k) => k !== key) })),
    moveQueue: (from, to) =>
      set((s) => {
        const q = [...s.queue];
        const [item] = q.splice(from, 1);
        q.splice(to, 0, item);
        return { queue: q };
      }),
    clearQueue: () => set((s) => ({ queue: s.queue.filter((k) => k === s.cur) })),
  };
};
