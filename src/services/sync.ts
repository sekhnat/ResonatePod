import { GpodderClient, syncOnce, type EpisodeAction, type SyncResult } from '../../shared/gpodder';
import { epKey } from '../data';
import { platform } from '../platform';
import { getEp } from '../store/selectors';
import type { Data, SyncState } from '../store/types';

/** A client for the sync account, with the password from the secret store. */
export async function clientFor(account: Pick<SyncState, 'server' | 'user' | 'device'>): Promise<GpodderClient> {
  const password = (await platform.getSecret('gpodder')) ?? '';
  return new GpodderClient({ server: account.server, user: account.user, password, device: account.device }, platform.http);
}

/** One round with the server. `sent` are the pending actions it took, so only those are cleared afterwards. */
export async function fetchSync(sync: SyncState, localFeeds: string[]): Promise<{ result: SyncResult; sent: Set<EpisodeAction> }> {
  const client = await clientFor(sync);
  const sent = new Set(sync.pending);
  const result = await syncOnce(client, { local: localFeeds, known: sync.known, subsSince: sync.subsSince, actionsSince: sync.actionsSince, pending: sync.pending });
  return { result, sent };
}

/** `eps` with the play positions from other devices applied wherever they are newer than ours; the playing episode is left alone. */
export function applyRemotePositions(state: Pick<Data, 'shows' | 'eps' | 'cur'>, actions: EpisodeAction[]): Data['eps'] {
  const byUrl = new Map<string, string>();
  for (const sh of state.shows) for (const e of sh.eps) byUrl.set(e.enclosureUrl, epKey(sh.id, e.guid));
  const eps = { ...state.eps };
  for (const a of actions) {
    const key = byUrl.get(a.episode);
    if (!key || a.action !== 'play' || key === state.cur || a.position == null) continue;
    const when = Date.parse(a.timestamp.endsWith('Z') ? a.timestamp : a.timestamp + 'Z');
    const st = eps[key] ?? getEp(state, key);
    if ((st.lastPlayed ?? 0) >= when) continue;
    const done = !!a.total && a.position >= a.total - 30;
    eps[key] = { ...st, pos: done ? 0 : a.position, played: done || st.played, playedAt: done ? when : st.playedAt, lastPlayed: when };
  }
  return eps;
}
