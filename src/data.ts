// Seed catalogue. Mirrors the design prototype; a real build would populate
// this from parsed RSS feeds.

export interface Show {
  id: string;
  title: string;
  author: string;
  hue: number;
  cat: string;
  freq: string;
  desc: string;
  feedUrl: string;
  eps: string[];
  /** Episode durations in minutes, parallel to `eps`. */
  durs: number[];
}

export interface Chapter {
  t: string;
  at: number;
}

export interface TranscriptLine {
  who: string;
  text: string;
  at: number;
}

export interface DiscoverEntry {
  title: string;
  author: string;
  blurb: string;
  cat: string;
  freq: string;
  hue: number;
  eps: string[];
  durs: number[];
}

export const SHOWS: Show[] = [
  { id: 'kp', title: 'Kernel Panic Hour', author: 'Ines Varga & Tom Achebe', hue: 289, cat: 'Technology', freq: 'Weekly', feedUrl: 'https://kernelpanic.fm/feed.xml', desc: 'Two long-time sysadmins talk through the week in free software — kernels, desktops, packaging fights — and answer listener mail with more patience than it deserves.', eps: ['Wayland, five years on', 'Rolling releases vs. the rest of us', 'The init wars, revisited', 'What is actually in a kernel config', 'Filesystems we have loved', 'Dotfiles as autobiography'], durs: [72, 64, 58, 81, 69, 55] },
  { id: 'sa', title: 'The Slow Archive', author: 'Hollis Brennan', hue: 70, cat: 'History', freq: 'Fortnightly', feedUrl: 'https://slowarchive.org/rss', desc: 'Unhurried stories from the edges of the historical record.', eps: ['The library that burned twice', 'Maps drawn from memory', 'A history of the footnote', 'Lighthouse keepers’ logs', 'The first radio dramas', 'Letters never sent'], durs: [48, 52, 41, 57, 44, 50] },
  { id: 'fn', title: 'Field Notes on Sound', author: 'Aiko Lindqvist', hue: 200, cat: 'Arts', freq: 'Monthly', feedUrl: 'https://fieldnotes.audio/feed', desc: 'Recording, listening and the places sound lives.', eps: ['Recording rain properly', 'The hum of cities', 'Contact microphones', 'Silence is a texture', 'Tape, again', 'Birdsong at 4am'], durs: [36, 42, 33, 39, 45, 31] },
  { id: 'ct', title: 'Compile Time', author: 'Dev Okafor', hue: 250, cat: 'Technology', freq: 'Weekly', feedUrl: 'https://compiletime.dev/podcast.xml', desc: 'Build systems, toolchains and why your CI is slow.', eps: ['Linkers, demystified', 'Why builds get slow', 'Reproducible everything', 'Cross-compiling for fun', 'The cache invalidation episode', 'Make is fine, actually'], durs: [51, 47, 62, 44, 58, 39] },
  { id: 'mf', title: 'Margins & Footnotes', author: 'Clara Oyelaran', hue: 20, cat: 'Books', freq: 'Weekly', feedUrl: 'https://marginsandfootnotes.net/feed', desc: 'A reading podcast for people who annotate.', eps: ['On rereading', 'Translators as authors', 'The unfinished novel', 'Marginalia of the famous', 'Short books, long shadows', 'Index as art form'], durs: [44, 38, 51, 40, 36, 47] },
  { id: 'ns', title: 'Night Shift Radio', author: 'The Night Shift Collective', hue: 320, cat: 'Society', freq: 'Daily', feedUrl: 'https://nightshift.radio/rss', desc: 'Conversations with people who work while the rest of us sleep.', eps: ['The bakery at 3am', 'Air traffic, overnight', 'Hospital porters', 'Lock keepers', 'Signal box', 'Last bus'], durs: [28, 31, 26, 33, 29, 24] },
  { id: 'se', title: 'Small Engines', author: 'Ruth Castellanos', hue: 150, cat: 'Science', freq: 'Fortnightly', feedUrl: 'https://smallengines.show/feed.xml', desc: 'Tiny machines, big physics.', eps: ['How a carburettor breathes', 'Two-stroke vs four', 'The humble flywheel', 'Spark, explained', 'Engines in miniature', 'Repairing, not replacing'], durs: [39, 43, 37, 41, 46, 35] },
];

export const DATES = ['Today', 'Yesterday', 'Oct 22', 'Oct 18', 'Oct 11', 'Oct 4'];
/** Seed per-index state for the original subscriptions. */
export const SEED_DOWNLOADED = [false, true, true, false, false, false];
export const SEED_PLAYED = [false, false, false, true, true, false];
export const SEED_PROGRESS = [0, 0.35, 0, 1, 1, 0];
export const SEED_UNPLAYED: Record<string, number> = { kp: 3, sa: 2, fn: 1, ct: 2, mf: 0, ns: 1, se: 0 };

const KP_CH: [string, number][] = [['Cold open', 0], ['Why Wayland took so long', 300], ['Screen sharing & portals', 1260], ['Fractional scaling, finally', 2280], ['Listener questions', 3300], ['Picks', 3960]];
const GEN_CH = ['Intro', 'Part one', 'Part two', 'Part three', 'Outro'];
const GEN_CH_AT = [0, 0.06, 0.33, 0.66, 0.93];

export const CATS = ['Popular', 'Technology', 'Science', 'History', 'Arts', 'Society', 'Books'];

export const DISCOVER: DiscoverEntry[] = [
  { title: 'Packet Loss', author: 'Mara Quist', blurb: 'Networking war stories from the people who keep packets moving.', cat: 'Technology', freq: 'Weekly', hue: 230, eps: ['The BGP leak that ate a Tuesday', 'MTU, explained slowly', 'DNS is always the answer'], durs: [54, 47, 61] },
  { title: 'Quiet Machines', author: 'Jonas Ebert', blurb: 'Fanless builds, low-power homelabs, silent computing.', cat: 'Technology', freq: 'Monthly', hue: 180, eps: ['A server under 10 watts', 'Passive cooling myths', 'The silent NAS'], durs: [42, 38, 45] },
  { title: 'The Long Index', author: 'Priya Natarajan', blurb: 'Librarians on how we find things.', cat: 'Society', freq: 'Fortnightly', hue: 40, eps: ['Card catalogues', 'Subject headings and their politics', 'Search before search'], durs: [36, 41, 39] },
  { title: 'Open Hardware Weekly', author: 'Sam Oduya', blurb: 'Schematics, firmware and repairable devices.', cat: 'Technology', freq: 'Weekly', hue: 270, eps: ['Reflashing a router', 'Right to repair, a year in', 'KiCad for the curious'], durs: [48, 52, 44] },
  { title: 'Tidewater', author: 'Elin Marsh', blurb: 'Coastal ecology, one estuary at a time.', cat: 'Science', freq: 'Monthly', hue: 190, eps: ['Salt marsh carbon', 'The oyster reef', 'Mudflats at dawn'], durs: [33, 37, 35] },
  { title: 'Second Draft', author: 'Theo Achterberg', blurb: 'Writers read their earliest drafts aloud.', cat: 'Arts', freq: 'Weekly', hue: 350, eps: ['The draft I burned', 'Chapter one, seven times', 'Cutting the prologue'], durs: [29, 34, 31] },
];

const KP_TRANSCRIPT: TranscriptLine[] = [
  { at: 0, who: 'Tom', text: 'Welcome back to Kernel Panic Hour. Ines, you promised me a calm week.' },
  { at: 300, who: 'Ines', text: 'Let’s start with why Wayland took so long, because it is not the story people tell.' },
  { at: 820, who: 'Tom', text: 'The protocol was the easy part. Everything around it was the hard part.' },
  { at: 1150, who: 'Ines', text: 'Right — and the hardest piece turned out to be screen sharing.' },
  { at: 1500, who: 'Tom', text: 'Because X just let any client read the whole screen, and nobody missed that until it was gone.' },
  { at: 1700, who: 'Ines', text: 'So the portal handles the permission prompt, and the compositor never has to trust the app.' },
  { at: 1820, who: 'Tom', text: 'Which is the right call — it just took everyone a while to wire it up.' },
  { at: 1900, who: 'Ines', text: 'And now screen sharing in a browser just… works. Mostly.' },
  { at: 2030, who: 'Tom', text: 'Mostly. Let’s talk about fractional scaling before the mail bag eats us alive.' },
  { at: 2600, who: 'Ines', text: 'The short version: one point two five times now looks like one point two five times.' },
  { at: 2940, who: 'Tom', text: 'First letter this week asks whether they should switch their dad’s laptop. Yes. Next.' },
  { at: 3540, who: 'Ines', text: 'My pick is a terminal font I have used for exactly six days and will defend forever.' },
];

export const art = (h: number) => `linear-gradient(140deg, oklch(0.46 0.07 ${h}), oklch(0.27 0.04 ${h}))`;

export const mono = (t: string) =>
  t.replace(/&/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};

export const epKey = (showId: string, idx: number) => `${showId}:${idx}`;

export const parseKey = (key: string): [string, number] => {
  const at = key.lastIndexOf(':');
  return [key.slice(0, at), Number(key.slice(at + 1))];
};

export interface EpisodeInfo {
  key: string;
  show: Show;
  idx: number;
  title: string;
  /** Duration in seconds. */
  dur: number;
  durMin: number;
  date: string;
  sizeMb: number;
}

export const episodeInfo = (show: Show, idx: number): EpisodeInfo => ({
  key: epKey(show.id, idx),
  show,
  idx,
  title: show.eps[idx],
  dur: show.durs[idx] * 60,
  durMin: show.durs[idx],
  date: DATES[idx] ?? 'Earlier',
  sizeMb: Math.round(show.durs[idx] * 1.1),
});

export const chaptersFor = (ep: EpisodeInfo): Chapter[] => {
  if (ep.show.id === 'kp' && ep.idx === 1) return KP_CH.map(([t, at]) => ({ t, at: (at * 64 * 60) / 4320 }));
  return GEN_CH.map((t, i) => ({ t, at: Math.round(ep.dur * GEN_CH_AT[i]) }));
};

export const transcriptFor = (ep: EpisodeInfo): TranscriptLine[] | null =>
  ep.show.id === 'kp' && ep.idx === 1 ? KP_TRANSCRIPT : null;
