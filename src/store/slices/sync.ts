import { GpodderClient, syncOnce } from '../../../shared/gpodder';
import { epKey } from '../../data';
import { gpodderResult, type DirectoryResult } from '../../lib/directory';
import { platform } from '../../platform';
import { initialData } from '../initial';
import { slug } from '../helpers';
import { getEp } from '../selectors';
import type { Slice } from '../types';

export const createSyncSlice: Slice<'gpodderSuggestions' | 'configureSync' | 'disconnectSync' | 'runSync'> = (set, get) => {
  return {
    gpodderSuggestions: async () => {
      const s = get();
      if (!s.sync.server) return [];
      const password = (await platform.getSecret('gpodder')) ?? '';
      const client = new GpodderClient({ server: s.sync.server, user: s.sync.user, password, device: s.sync.device }, platform.http);
      const list = await client.suggestions(12).catch(() => []);
      return (Array.isArray(list) ? list : []).map((p) => gpodderResult(p)).filter((r): r is DirectoryResult => !!r);
    },
    configureSync: async (server, user, password) => {
      const device = get().sync.device || `resonate-${slug(platform.hostname)}-${Math.random().toString(36).slice(2, 6)}`;
      const client = new GpodderClient({ server, user, password, device }, platform.http);
      try {
        await client.login();
        await client.registerDevice(`Resonate on ${platform.hostname}`);
      } catch (err) {
        get().toast(`Sync: ${(err as Error).message}`);
        return false;
      }
      await platform.setSecret('gpodder', password);
      set({ sync: { server, user, device, subsSince: 0, actionsSince: 0, known: [], pending: [], lastSynced: 0 } });
      await get().runSync();
      return true;
    },
    disconnectSync: () => {
      void platform.setSecret('gpodder', null);
      set((s) => ({ sync: { ...initialData.sync, device: s.sync.device } }));
      get().toast('Sync turned off');
    },
    runSync: async () => {
      const s = get();
      if (!s.sync.server || s.syncing) return;
      set({ syncing: true });
      try {
        const password = (await platform.getSecret('gpodder')) ?? '';
        const client = new GpodderClient({ server: s.sync.server, user: s.sync.user, password, device: s.sync.device }, platform.http);
        const pending = s.sync.pending;
        const sent = new Set(pending);
        const r = await syncOnce(client, { local: s.shows.map((x) => x.feedUrl), known: s.sync.known, subsSince: s.sync.subsSince, actionsSince: s.sync.actionsSince, pending });
        for (const url of r.addLocally) await get().addFeed(url, { quiet: true });
        for (const url of r.removeLocally) { const sh = get().shows.find((x) => x.feedUrl === url); if (sh) get().unsubscribe(sh.id, true); }
        // Apply remote play positions that are newer than ours.
        const now = get();
        const byUrl = new Map<string, string>();
        for (const sh of now.shows) for (const e of sh.eps) byUrl.set(e.enclosureUrl, epKey(sh.id, e.guid));
        const eps = { ...now.eps };
        for (const a of r.remoteActions) {
          const key = byUrl.get(a.episode);
          if (!key || a.action !== 'play' || key === now.cur || a.position == null) continue;
          const when = Date.parse(a.timestamp.endsWith('Z') ? a.timestamp : a.timestamp + 'Z');
          const st = eps[key] ?? getEp(now, key);
          if ((st.lastPlayed ?? 0) >= when) continue;
          const done = !!a.total && a.position >= a.total - 30;
          eps[key] = { ...st, pos: done ? 0 : a.position, played: done || st.played, playedAt: done ? when : st.playedAt, lastPlayed: when };
        }
        set((x) => ({
          eps,
          sync: { ...x.sync, subsSince: r.subsSince, actionsSince: r.actionsSince, known: x.shows.map((sh) => sh.feedUrl), pending: x.sync.pending.filter((a) => !sent.has(a)), lastSynced: Date.now() },
        }));
      } catch (err) {
        get().toast(`Sync failed: ${(err as Error).message}`);
      } finally {
        set({ syncing: false });
      }
    },
  };
};
