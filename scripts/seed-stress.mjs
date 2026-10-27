// Fills a Resonate data folder with a large synthetic library, to try the app against one.
//
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/seed-stress.mjs <data folder> [shows=20] [episodes=2000]
//   RESONATE_USER_DATA=<data folder> npm start
//
// It runs under Electron's Node because better-sqlite3 is built for Electron. The database is written through the
// app's own LibraryDb, so what it makes is what the app would have saved.
import { mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const [dir, shows = '20', episodes = '2000'] = process.argv.slice(2);
if (!dir) { console.error('usage: electron scripts/seed-stress.mjs <data folder> [shows] [episodes]'); process.exit(1); }
const root = path.resolve(import.meta.dirname, '..');
mkdirSync(dir, { recursive: true });

// LibraryDb is TypeScript: bundle it next to node_modules, so that it finds better-sqlite3.
const bundle = path.join(root, 'node_modules/.cache/seed-library.cjs');
await build({ entryPoints: [path.join(root, 'electron/db/library.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['better-sqlite3'], outfile: bundle, logLevel: 'error' });
const { LibraryDb } = createRequire(import.meta.url)(bundle);

const file = path.join(dir, 'library.db');
const db = new LibraryDb(file);
if (!db.isEmpty()) { console.error(`${file} already has a library; use an empty folder`); process.exit(1); }

const DAY = 864e5;
const now = Date.now();
const notes = 'Show notes for this episode, with the usual links, sponsor reads and a long list of timestamps. ';
const started = performance.now();
const n = { shows: +shows, episodes: +episodes };
for (let i = 0; i < n.shows; i++) {
  const id = `show-${i}`;
  const eps = Array.from({ length: n.episodes }, (_, j) => ({
    guid: `${id}-ep-${j}`, title: `Episode ${n.episodes - j}: a reasonably long title about topic ${j % 97}`, pubDate: now - j * 3 * DAY,
    duration: 1800 + (j % 40) * 60, enclosureUrl: `https://cdn.example/${id}/${j}.mp3`, enclosureType: 'audio/mpeg', sizeBytes: 30e6 + j,
    description: (`#${j} ${notes}`).repeat(21).slice(0, 2048),
  }));
  // A few episodes of each show have been touched: the newest are new, and a fifth of the rest were played.
  const epState = Object.fromEntries(eps.flatMap((e, j) => (j < 2 ? [[`${id}:${e.guid}`, { played: false, pos: 0, inbox: true }]] : j % 5 === 0 ? [[`${id}:${e.guid}`, { played: true, pos: 0, inbox: false, playedAt: now - j * DAY, lastPlayed: now - j * DAY }]] : [])));
  db.patch({
    shows: { upsert: [{ id, title: `Stress Show ${i}`, author: `Author ${i}`, hue: (i * 37) % 360, cat: 'Technology', freq: 'Weekly', desc: 'A synthetic show.', feedUrl: `https://stress.example/${id}.xml`, subscribedAt: now - 400 * DAY }], order: Array.from({ length: i + 1 }, (_, k) => `show-${k}`) },
    episodes: { upsert: eps.map((ep) => ({ show: id, ep })) },
    epState: { upsert: epState },
  });
}
db.patch({ kv: { folder: path.join(dir, 'Podcasts'), lastChecked: now } }); // not due for a refresh
const wrote = performance.now() - started;
const t = performance.now();
const lib = db.load();
const read = performance.now() - t;
db.close();
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;
console.log(`${n.shows} shows x ${n.episodes} episodes written in ${wrote.toFixed(0)} ms`);
console.log(`library.db: ${mb(statSync(file).size)}; reading it back: ${read.toFixed(0)} ms for ${lib.shows.reduce((a, s) => a + s.eps.length, 0)} episodes and ${Object.keys(lib.epState).length} state records`);
console.log(`start it with: RESONATE_USER_DATA=${dir} npm start`);
