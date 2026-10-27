import { upgradeSettings } from '../../shared/settings';
import { defaultCountry } from '../lib/directory';
import type { Data, Ui } from './types';

// ---------- initial state ----------

/** What is saved: the library (shows, episode state) and these named settings. */
export const initialData: Data = {
  shows: [],
  eps: {},
  cur: null,
  speed: 1.2,
  volume: 0.8,
  muted: false,
  queue: [],
  dlDone: [],
  dlPending: [],
  dlPaused: false,
  ovr: {},
  sorts: {},
  tg: { auto: true, metered: true, silence: true, notify: false, deletePlayed: true, autostart: false },
  sv: upgradeSettings(undefined),
  folder: '~/Podcasts',
  storageLimitGb: 40,
  sync: { server: '', user: '', device: '', subsSince: 0, actionsSince: 0, known: [], pending: [], lastSynced: 0 },
  lastChecked: 0,
  trimSaved: 0,
  directory: { country: defaultCountry(), source: 'all', podcastIndex: false },
};

export const initialUi: Ui = {
  hydrated: false,
  playing: false,
  dl: [],
  meta: {},
  video: false,
  pendingMove: null,
  authFor: null,
  metered: null,
  folderBytes: null,
  trimPending: 0,
  screen: 'inbox',
  history: [],
  showId: '',
  filter: 'All',
  cat: 'Popular',
  discoverQuery: '',
  npOpen: true,
  npFull: false,
  cfgOpen: false,
  palette: false,
  query: '',
  menu: null,
  dialog: null,
  refreshing: false,
  syncing: false,
  adding: 0,
  sleep: { mode: 'off' },
  toasts: [],
};
