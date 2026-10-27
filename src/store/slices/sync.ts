import { GpodderClient } from '../../../shared/gpodder';
import { gpodderResult, type DirectoryResult } from '../../lib/directory';
import { platform } from '../../platform';
import { applyRemotePositions, clientFor, fetchSync } from '../../services/sync';
import { initialData } from '../initial';
import { slug } from '../helpers';
import type { Slice } from '../types';

export const createSyncSlice: Slice<'gpodderSuggestions' | 'configureSync' | 'disconnectSync' | 'runSync'> = (set, get) => {
  return {
    gpodderSuggestions: async () => {
      const s = get();
      if (!s.sync.server) return [];
      const client = await clientFor(s.sync);
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
        const { result: r, sent } = await fetchSync(s.sync, s.shows.map((x) => x.feedUrl));
        for (const url of r.addLocally) await get().addFeed(url, { quiet: true });
        for (const url of r.removeLocally) { const sh = get().shows.find((x) => x.feedUrl === url); if (sh) get().unsubscribe(sh.id, true); }
        // Apply remote play positions that are newer than ours.
        const eps = applyRemotePositions(get(), r.remoteActions);
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
