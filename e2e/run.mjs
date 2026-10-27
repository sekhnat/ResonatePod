// End-to-end test: launches the built Electron app against a local feed server.
// Run with `npm run test:e2e` (needs a display; use `xvfb-run -a` on headless Linux).
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright-core');
const electronPath = require('electron');
const shots = process.env.E2E_SHOTS ?? mkdtempSync(path.join(tmpdir(), 'resonate-shots-'));

// ---- fixture media: 16-bit mono WAV, tone/silence segments ----
function wav(segments) {
  const rate = 8000;
  const samples = [];
  for (const [secs, freq] of segments) for (let i = 0; i < secs * rate; i++) samples.push(freq ? Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000) : 0);
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => buf.writeInt16LE(s, 44 + i * 2));
  return buf;
}
const media = {
  '/ep1.wav': wav([[3, 440], [6, 0], [3, 440]]), // 12 s with a long pause for silence trim
  '/ep2.wav': wav([[5, 330]]),
  // Behind HTTP Basic auth, in the private feed:
  '/p/chapters.mp3': readFileSync('test/fixtures/chapters.mp3'), // ID3 CHAP frames written by ffmpeg
  '/p/video.mp4': readFileSync('test/fixtures/video.mp4'),
  '/p/flaky.wav': wav([[2, 520]]),
  '/p/slow.wav': wav([[20, 260]]),
};
const AUTH = 'Basic ' + Buffer.from('ana:pw').toString('base64');
const hits = {};
const rangesFor = {};
// The slow episode sends its first 64 KB and then holds the connection open, so a
// restart interrupts it at a known point; clearing this lets it finish.
let holdSlow = true;
const HOLD = 65536;
const chapters = JSON.stringify({ version: '1.2.0', chapters: [{ startTime: 0, title: 'Opening' }, { startTime: 9, title: 'Second half' }] });
const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n<v Ana>Testing one two.\n\n00:00:09.000 --> 00:00:12.000\n<v Ben>And we are back.\n';

let base = '';
const feed = () => `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel><title>Fixture FM</title><itunes:author>Resonate Tests</itunes:author><description>A feed served by the e2e test.</description><link>${base}/</link>
<item><title>Episode two</title><guid>fx-2</guid><pubDate>${new Date().toUTCString()}</pubDate><enclosure url="${base}/ep2.wav" length="${media['/ep2.wav'].length}" type="audio/wav"/></item>
<item><title>Episode one</title><guid>fx-1</guid><pubDate>${new Date(Date.now() - 864e5).toUTCString()}</pubDate><enclosure url="${base}/ep1.wav" length="${media['/ep1.wav'].length}" type="audio/wav"/>
<podcast:chapters url="${base}/ch.json" type="application/json+chapters"/><podcast:transcript url="${base}/t.vtt" type="text/vtt"/></item>
</channel></rss>`;

// A show whose title and author are far longer than a grid card.
const longFeed = () => `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel><title>The Strange Case of Starship Iris and Other Remarkably Long Podcast Titles</title><itunes:author>Jessica Best (Procyon Podcast Network) with Friends</itunes:author><description>Long names.</description>
<item><title>Pilot</title><guid>long-1</guid><pubDate>${new Date().toUTCString()}</pubDate><enclosure url="${base}/ep2.wav" length="${media['/ep2.wav'].length}" type="audio/wav"/></item>
</channel></rss>`;

const flipFeed = () => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Flip FM</title><description>Answers once, then goes quiet.</description>
<item><title>Only episode</title><guid>flip-1</guid><pubDate>${new Date().toUTCString()}</pubDate><enclosure url="${base}/ep2.wav" length="${media['/ep2.wav'].length}" type="audio/wav"/></item>
</channel></rss>`;

// A back catalogue: 600 episodes, numbered from the oldest.
const bigFeed = () => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Big Catalogue</title><description>Lots of episodes.</description>
${Array.from({ length: 600 }, (_, i) => `<item><title>Big episode ${600 - i}</title><guid>big-${i}</guid><pubDate>${new Date(Date.now() - i * 864e5).toUTCString()}</pubDate><enclosure url="${base}/ep2.wav" length="${media['/ep2.wav'].length}" type="audio/wav"/></item>`).join('\n')}
</channel></rss>`;

const html = '<html><body><cite>Ana:</cite><time>0:00:00</time><p>Welcome to the members feed.</p><cite>Ben:</cite><time>0:00:02</time><p>Mail time.</p></body></html>';
const privateFeed = () => {
  const item = (title, guid, file, type, ago, extra = '') => `<item><title>${title}</title><guid>${guid}</guid><pubDate>${new Date(Date.now() - ago * 36e5).toUTCString()}</pubDate><enclosure url="${base}${file}" length="${media[file].length}" type="${type}"/>${extra}</item>`;
  return `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel><title>Members Only</title><itunes:author>Resonate Tests</itunes:author><description>A private feed.</description>
${item('Slow episode', 'm-4', '/p/slow.wav', 'audio/wav', 0)}
${item('Flaky episode', 'm-3', '/p/flaky.wav', 'audio/wav', 1)}
${item('Video episode', 'm-2', '/p/video.mp4', 'video/mp4', 2)}
${item('Chaptered episode', 'm-1', '/p/chapters.mp3', 'audio/mpeg', 3, `<podcast:transcript url="${base}/p/t.html" type="text/html"/>`)}
</channel></rss>`;
};

// ---- podcast directories (recorded responses; the app reaches them through RESONATE_URL_REWRITE) ----
const dirFixture = (name) => readFileSync(`test/fixtures/directory/${name}.json`, 'utf8').replaceAll('https://www.feeds.example', `${base}/feeds`).replaceAll('http://feeds.example', `${base}/feeds`).replaceAll('https://feeds.example', `${base}/feeds`).replaceAll('https://gpodder.net/logo/', `${base}/feeds/art/logo-`);
const directoryRequests = [];
function directory(url, query) {
  directoryRequests.push(url + (query ? `?${query}` : ''));
  const p = new URLSearchParams(query);
  if (url === '/apple/search') return dirFixture(p.get('entity') === 'podcastEpisode' ? 'apple-episodes' : 'apple-search');
  if (url === '/apple/lookup') {
    const ids = (p.get('id') ?? '').split(',');
    const all = JSON.parse(dirFixture('apple-lookup'));
    return JSON.stringify({ results: all.results.filter((r) => ids.includes(String(r.collectionId))) });
  }
  const chart = /^\/apple\/(\w\w)\/rss\/toppodcasts\//.exec(url);
  if (chart) return dirFixture(chart[1] === 'gb' ? 'apple-chart-gb' : 'apple-chart-us');
  if (url === '/gpodder/search.json') return dirFixture('gpodder-search');
  if (url === '/gpodder/toplist/50.json') return dirFixture('gpodder-toplist');
  if (url === '/gpodder/api/2/tag/technology/50.json') return dirFixture('gpodder-tag-technology');
  if (url === '/fyyd/0.2/search/podcast') return dirFixture('fyyd-search');
  return null;
}
// Every show a directory lists gets a one-episode feed at /feeds/<slug>.xml.
const titleFor = (slug) => slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ').replace('Kernel Panic', 'Kernel Panic Hour').replace('Linux Unplugged', 'LINUX Unplugged');
const directoryFeed = (slug) => `<?xml version="1.0"?><rss version="2.0"><channel><title>${titleFor(slug)}</title><description>From the directory.</description>
<item><title>${titleFor(slug)} #1</title><guid>${slug}-1</guid><pubDate>${new Date().toUTCString()}</pubDate><enclosure url="${base}/ep2.wav" length="${media['/ep2.wav'].length}" type="audio/wav"/></item></channel></rss>`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  const hit = (hits[url] = (hits[url] ?? 0) + 1);
  (rangesFor[url] ??= []).push(req.headers.range);
  if (url === '/old.xml') return res.writeHead(301, { Location: '/feed.xml' }).end();
  const dir = directory(url, req.url.split('?')[1] ?? '');
  if (dir != null) return res.writeHead(200, { 'Content-Type': 'application/json' }).end(dir);
  if (url.startsWith('/feeds/art/')) return res.writeHead(200, { 'Content-Type': 'image/png' }).end(PNG);
  const listed = /^\/feeds\/([\w-]+)\.xml$/.exec(url);
  if (listed) return res.writeHead(200, { 'Content-Type': 'application/rss+xml' }).end(directoryFeed(listed[1]));
  if (url === '/feed.xml') return res.writeHead(200, { 'Content-Type': 'application/rss+xml' }).end(feed());
  if (url === '/long.xml') return res.writeHead(200, { 'Content-Type': 'application/rss+xml' }).end(longFeed());
  if (url === '/big.xml') return res.writeHead(200, { 'Content-Type': 'application/rss+xml' }).end(bigFeed());
  if (url === '/huge.xml') {
    // 60 MB with no Content-Length, so only counting the bytes can stop it.
    res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
    const chunk = Buffer.alloc(1 << 20, 32);
    let sent = 0;
    const pump = () => {
      while (sent < 60 && !res.destroyed) { sent++; if (!res.write(chunk)) return void res.once('drain', pump); }
      res.end();
    };
    res.on('error', () => {});
    return pump();
  }
  // Answers once so it can be subscribed to, then never again.
  if (url === '/flip.xml') return hit === 1 ? res.writeHead(200, { 'Content-Type': 'application/rss+xml' }).end(flipFeed()) : undefined;
  if ((url === '/private.xml' || url.startsWith('/p/')) && req.headers.authorization !== AUTH) {
    return res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="members"' }).end();
  }
  if (url === '/private.xml') return res.writeHead(200, { 'Content-Type': 'application/rss+xml' }).end(privateFeed());
  if (url === '/p/t.html') return res.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
  if (url === '/p/flaky.wav' && hit === 1) return res.writeHead(503).end();
  if (url === '/ch.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(chapters);
  if (url === '/t.vtt') return res.writeHead(200, { 'Content-Type': 'text/vtt' }).end(vtt);
  const body = media[url];
  if (!body) return res.writeHead(404).end();
  const ctype = { mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav' }[url.split('.').pop()];
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (url === '/p/slow.wav' && holdSlow) {
    const start = m ? +m[1] || 0 : 0;
    res.writeHead(m ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': body.length - start, ...(m ? { 'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}` } : {}) });
    res.write(body.subarray(start, Math.max(start, HOLD)));
    return; // ...and never finish while held
  }
  if (m) {
    const start = +m[1] || 0;
    const end = m[2] ? +m[2] : body.length - 1;
    return res.writeHead(206, { 'Content-Type': ctype, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' }).end(body.subarray(start, end + 1));
  }
  res.writeHead(200, { 'Content-Type': ctype, 'Content-Length': body.length, 'Accept-Ranges': 'bytes' }).end(body);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
base = `http://127.0.0.1:${server.address().port}`;

// ---- launch ----
const home = mkdtempSync(path.join(tmpdir(), 'resonate-home-'));
// E2E_APP=release/linux-unpacked/resonate tests a packaged build instead of the dev tree.
const packaged = process.env.E2E_APP;
const errors = [];
let app;
let page;
async function launch() {
  app = await electron.launch({
    executablePath: packaged ? path.resolve(packaged) : electronPath,
    args: packaged ? ['--no-sandbox'] : ['.', '--no-sandbox'],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), RESONATE_USER_DATA: path.join(home, 'config'), XDG_CURRENT_DESKTOP: 'KDE', RESONATE_HTTP_TIMEOUT_MS: '2000',
      RESONATE_URL_REWRITE: JSON.stringify({ 'https://itunes.apple.com': `${base}/apple`, 'https://gpodder.net': `${base}/gpodder`, 'https://api.fyyd.de': `${base}/fyyd` }) },
  });
  page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
}
await launch();
const podcasts = (show) => path.join(home, 'Podcasts', show);
const waitFor = async (what, pred, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (pred()) return;
  throw new Error(`timed out waiting for ${what}`);
};
const step = async (name, fn) => { process.stdout.write(`• ${name} … `); await fn(); console.log('ok'); };
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
const time = () => page.locator('[aria-label="Seek"]').getAttribute('aria-valuenow').then(Number);

try {
  await step('onboarding is shown on first run', async () => {
    await page.getByText('Welcome to Resonate').waitFor();
    assert.equal(await page.locator('.plasma').count(), 0, 'no fake taskbar');
    // AntennaPod-style suggestions: the regional Apple chart.
    await page.getByRole('region', { name: 'Popular in your region' }).getByText('Daily Bytes').waitFor();
    assert.ok(directoryRequests.some((u) => u.startsWith('/apple/us/rss/toppodcasts/limit=25/explicit=true/json')), directoryRequests.join('\n'));
    await shot('01-welcome');
  });

  await step('subscribe by pasting a feed URL (one that has moved)', async () => {
    // /old.xml permanently redirects to /feed.xml; the OPML export below checks the stored URL.
    await page.getByPlaceholder('Search podcasts, or paste an RSS feed URL').fill(`${base}/old.xml`);
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Fixture FM' }).waitFor();
    await page.getByText('Episode one').waitFor();
    await shot('02-show');
  });

  await step('episodes can be sorted, and the choice is kept per show', async () => {
    const titles = () => page.locator('.h-row').evaluateAll((rows) => rows.map((r) => r.textContent.match(/Episode (one|two)/)?.[0]));
    const sort = page.getByLabel('Sort episodes');
    assert.deepEqual(await titles(), ['Episode two', 'Episode one']);
    await sort.selectOption('Oldest first');
    assert.deepEqual(await titles(), ['Episode one', 'Episode two']);
    await shot('02b-sorted');
    await page.getByRole('button', { name: 'New episodes' }).click();
    assert.equal(await page.getByLabel('Sort episodes').inputValue(), 'Newest first', 'the inbox has its own sort');
    await page.getByRole('button', { name: 'Fixture FM' }).click();
    assert.equal(await page.getByLabel('Sort episodes').inputValue(), 'Oldest first');
    await page.getByLabel('Sort episodes').selectOption('Newest first');
  });

  await step('screens grow with the window', async () => {
    const getSize = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
    const setSize = (size) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), size);
    const original = await getSize();
    try {
      await setSize([1900, 1000]);
      await page.waitForFunction(() => window.innerWidth >= 1800);
      for (const name of ['Fixture FM', 'New episodes', 'Queue', 'Downloads']) {
        await page.getByRole('button', { name }).first().click();
        const { main, screen } = await page.evaluate(() => ({ main: document.querySelector('main').clientWidth, screen: document.querySelector('main > div').getBoundingClientRect().width }));
        assert.ok(screen > main * 0.9, `${name} fills the window: ${screen}px of ${main}px`);
        if (name === 'Fixture FM') await shot('02c-wide');
      }
    } finally {
      await setSize(original);
      await page.waitForFunction((w) => window.innerWidth <= w, original[0]);
      await page.getByRole('button', { name: 'Fixture FM' }).first().click();
    }
  });

  await step('auto-download saves episodes to ~/Podcasts', async () => {
    const dir = path.join(home, 'Podcasts', 'Fixture FM');
    for (let i = 0; i < 50 && !(existsSync(dir) && readdirSync(dir).filter((f) => f.endsWith('.wav')).length === 2); i++) await page.waitForTimeout(100);
    const files = readdirSync(dir).filter((f) => f.endsWith('.wav')).sort();
    assert.equal(files.length, 2, `downloaded files: ${files}`);
    assert.equal(statSync(path.join(dir, files.find((f) => f.includes('Episode one')))).size, media['/ep1.wav'].length);
    await page.locator('[title="Downloaded"]').first().waitFor();
  });

  await step('play an episode: real audio advances, chapters and transcript load', async () => {
    await page.locator('.h-row', { hasText: 'Episode one' }).getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector('[aria-label="Seek"]')?.getAttribute('aria-valuenow')) >= 2, null, { timeout: 8000 });
    await page.getByText('Opening').first().waitFor();
    await page.getByText('Testing one two.').first().waitFor();
    await shot('03-playing');
  });

  await step('silence trim skips the pause', async () => {
    await page.waitForFunction(() => Number(document.querySelector('[aria-label="Seek"]')?.getAttribute('aria-valuenow')) >= 9, null, { timeout: 9000 });
    await page.locator('button[title="Open Now playing"]').click();
    const tag = await page.getByText(/Silence trim on · saved/).textContent();
    assert.match(tag, /saved 0:0[1-9]/, tag);
    await shot('04-full');
    await page.keyboard.press('Escape');
  });

  await step('pause, seek, speed and volume', async () => {
    await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
    const box = await page.locator('[aria-label="Seek"]').boundingBox();
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
    assert.equal(await time(), 3);
    await page.locator('button[title="Playback speed"]').click();
    assert.equal(await page.locator('button[title="Playback speed"]').textContent(), '1.5×');
    await page.getByRole('button', { name: 'Mute' }).click();
    await page.getByRole('button', { name: 'Unmute' }).waitFor();
  });

  await step('queue plays the next episode when one ends', async () => {
    await page.locator('nav button', { hasText: 'New episodes' }).click();
    await page.locator('.h-row', { hasText: 'Episode two' }).getByRole('button', { name: 'Add to queue', exact: true }).click();
    await page.locator('button[title="Queue"]').click();
    await page.getByRole('heading', { name: 'Queue' }).waitFor();
    await page.getByRole('button', { name: 'Unmute' }).click();
    await page.keyboard.press('Space');
    await page.locator('button[title="Open Now playing"]', { hasText: 'Episode two' }).waitFor({ timeout: 15000 });
    await shot('05-queue');
  });

  await step('delete a downloaded file', async () => {
    await page.locator('nav button', { hasText: 'Downloads' }).click();
    const before = readdirSync(path.join(home, 'Podcasts', 'Fixture FM')).length;
    await page.getByRole('button', { name: 'Delete file' }).first().click();
    await page.getByText('Deleted', { exact: true }).first().waitFor();
    assert.equal(readdirSync(path.join(home, 'Podcasts', 'Fixture FM')).length, before - 1);
    await shot('06-downloads');
  });

  await step('export OPML through the native save dialog, with the moved feed’s new address', async () => {
    const out = path.join(home, 'subs.opml');
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, out);
    await page.keyboard.press('Control+e');
    for (let i = 0; i < 30 && !existsSync(out); i++) await page.waitForTimeout(100);
    assert.match(readFileSync(out, 'utf8'), new RegExp(`xmlUrl="${base}/feed.xml"`));
  });

  await step('a private feed asks for a login', async () => {
    await page.locator('nav button', { hasText: 'Discover' }).click();
    await page.getByPlaceholder('Search podcasts, or paste an RSS feed URL').fill(`${base}/private.xml`);
    await page.keyboard.press('Enter');
    await page.getByText('This feed needs a login').waitFor();
    await page.getByLabel('Username').fill('ana');
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('The server didn’t accept that username and password.').waitFor();
    await page.getByLabel('Password').fill('pw');
    await shot('08-feed-login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'Members Only' }).waitFor();
    await page.getByText('Chaptered episode').waitFor();
  });

  await step('chapters inside a streamed MP3 and an HTML transcript', async () => {
    await page.locator('.h-row', { hasText: 'Chaptered episode' }).getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByText('Listener mail').first().waitFor();
    await page.getByText('Welcome to the members feed.').first().waitFor();
    await page.waitForFunction(() => Number(document.querySelector('[aria-label="Seek"]')?.getAttribute('aria-valuenow')) >= 1, null, { timeout: 8000 });
    assert.ok(rangesFor['/p/chapters.mp3'].some((r) => r === 'bytes=0-9'), 'chapters read with a small Range request');
    await shot('09-embedded-chapters');
  });

  await step('a video episode shows its picture', async () => {
    await page.locator('.h-row', { hasText: 'Video episode' }).getByRole('button', { name: 'Play', exact: true }).click();
    await page.locator('aside video').waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForFunction(() => { const v = document.querySelector('aside video'); return v && v.videoWidth === 160 && v.currentTime > 0.5; }, null, { timeout: 8000 });
    await shot('10-video');
  });

  await step('a failed download is retried automatically', async () => {
    await waitFor('the flaky episode to download', () => existsSync(podcasts('Members Only')) && readdirSync(podcasts('Members Only')).some((f) => f.includes('Flaky') && f.endsWith('.wav')), 20000);
    assert.ok(hits['/p/flaky.wav'] >= 2, `flaky requests: ${hits['/p/flaky.wav']}`);
  });

  await step('start at login writes an autostart entry', async () => {
    await page.locator('nav button', { hasText: 'Preferences' }).click();
    await page.getByRole('switch', { name: 'Start Resonate when you log in' }).click();
    const file = path.join(home, '.config', 'autostart', 'io.github.sekhnat.resonate.desktop');
    await waitFor('the autostart file', () => existsSync(file));
    assert.match(readFileSync(file, 'utf8'), /^Exec=.* --hidden$/m);
  });

  await step('a restart keeps the library, position, window size and interrupted download', async () => {
    await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
    const pos = await time();
    const current = await page.locator('button[title="Open Now playing"]').innerText();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
    const part = () => readdirSync(podcasts('Members Only')).find((f) => f.includes('Slow') && f.endsWith('.part'));
    await waitFor('the slow download to start', () => part() && statSync(path.join(podcasts('Members Only'), part())).size >= HOLD);
    await page.waitForTimeout(700);
    await app.close();
    assert.ok(part(), 'the partial file is kept');
    holdSlow = false;
    rangesFor['/p/slow.wav'] = [];
    await launch();
    await page.getByRole('heading', { name: 'New episodes' }).waitFor();
    assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()), [1100, 720]);
    await page.waitForFunction((t) => document.querySelector('button[title="Open Now playing"]')?.innerText === t, current);
    assert.ok(Math.abs((await time()) - pos) <= 1, `position ${await time()} vs ${pos}`);
    const done = () => readdirSync(podcasts('Members Only')).find((f) => f.includes('Slow') && f.endsWith('.wav'));
    await waitFor('the slow download to finish', done, 15000);
    assert.equal(statSync(path.join(podcasts('Members Only'), done())).size, media['/p/slow.wav'].length);
    assert.deepEqual(rangesFor['/p/slow.wav'], [`bytes=${HOLD}-`]);
    await shot('11-after-restart');
  });

  await step('changing the download folder moves downloaded files, even the one playing', async () => {
    const dest = path.join(home, 'Media', 'Pods');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, dest);
    await page.locator('nav button', { hasText: 'Preferences' }).click();
    await page.getByRole('button', { name: 'Change…' }).click();
    await page.getByText('Move downloaded episodes?').waitFor();
    await shot('12-move');
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    const moved = (show) => existsSync(path.join(dest, show)) ? readdirSync(path.join(dest, show)) : [];
    await waitFor('files in the new folder', () => moved('Members Only').some((f) => f.includes('Slow')) && moved('Fixture FM').length > 0);
    assert.ok(!existsSync(podcasts('Members Only')), 'old show folder removed once empty');
    await page.getByText('~/Media/Pods', { exact: true }).first().waitFor();
    const before = await time();
    await page.keyboard.press('Space');
    await page.waitForFunction((t) => Number(document.querySelector('[aria-label="Seek"]')?.getAttribute('aria-valuenow')) > t, before, { timeout: 8000 });
  });

  await step('the file bridge only touches the download folders', async () => {
    const outside = path.join(home, 'not-a-podcast.txt');
    writeFileSync(outside, 'keep me');
    const inside = path.join(home, 'Media', 'Pods', 'Fixture FM', readdirSync(path.join(home, 'Media', 'Pods', 'Fixture FM'))[0]);
    const status = (file) => page.evaluate(async (f) => (await fetch(`resonate-media://file/${encodeURIComponent(f)}`, { headers: { Range: 'bytes=0-9' } })).status, file);
    assert.equal(await status(inside), 206, 'a downloaded file is served');
    assert.equal(await status(outside), 403, 'a file elsewhere is refused');
    assert.equal(await status(path.join(home, 'Media', 'Pods', '..', 'not-a-podcast.txt')), 403, '.. does not get around it');
    // Chromium logs each refusal as a console error; these two are the ones this step asked for.
    const refused = (e) => /status of 403/.test(e);
    await waitFor('both refusals to be logged', () => errors.filter(refused).length >= 2);
    errors.splice(0, errors.length, ...errors.filter((e) => !refused(e)));
    await page.evaluate((f) => window.resonate.deleteFile(f), outside);
    assert.equal(readFileSync(outside, 'utf8'), 'keep me', 'delete leaves it alone');
    assert.deepEqual(await page.evaluate((f) => window.resonate.moveFiles(f.from, f.to, [f.file]), { from: path.join(home, 'Media', 'Pods'), to: path.join(home, 'elsewhere'), file: inside }), [], 'moving into a folder that was never chosen is refused');
  });

  await step('preferences and discover render', async () => {
    await page.locator('nav button', { hasText: 'Preferences' }).click();
    await page.getByText('Sync server').waitFor();
    // The header shows the version from package.json.
    await page.getByText(`Resonate ${JSON.parse(readFileSync('package.json', 'utf8')).version}`, { exact: true }).waitFor();
    await shot('07-settings');
  });

  await step('Discover suggests shows and lists the regional chart', async () => {
    await page.locator('nav button', { hasText: 'Discover' }).click();
    const suggested = page.getByRole('region', { name: 'Suggested for you' });
    await suggested.getByText('Deep Field').waitFor();
    await suggested.getByText('Apple top chart · United States').waitFor();
    await shot('13-discover');
    await page.getByRole('button', { name: 'Technology', exact: true }).click();
    await page.getByRole('region', { name: 'Top Technology podcasts · United States' }).getByText('Kernel Panic Hour').waitFor();
    assert.ok(directoryRequests.some((u) => u.startsWith('/apple/us/rss/toppodcasts/limit=30/genre=1318/explicit=true/json')));
    await page.getByRole('button', { name: 'Popular', exact: true }).click();
  });

  await step('searching all directories merges and labels the results', async () => {
    await page.getByPlaceholder('Search podcasts, or paste an RSS feed URL').fill('linux');
    const shows = page.getByRole('region', { name: 'Shows' });
    await shows.getByText('from Apple Podcasts, gpodder.net, fyyd').waitFor();
    const lu = shows.getByTestId('directory-card').filter({ hasText: 'LINUX Unplugged' });
    assert.equal(await lu.count(), 1, 'one card per feed');
    assert.deepEqual(await lu.locator('[title^="Found on"]').allInnerTexts(), ['Apple', 'gpodder']);
    await shows.getByText('Ubuntu Podcast', { exact: true }).waitFor(); // fyyd only
    await shows.getByText('Linux Voice', { exact: true }).waitFor(); // gpodder.net only
    assert.equal(await shows.getByText('Linux Exclusive', { exact: true }).count(), 0, 'shows without a public feed are skipped');
    await page.getByRole('region', { name: 'Episodes' }).getByText('Wayland, five years on').waitFor();
    await shot('14-search-all');
  });

  await step('gpodder.net as the directory, and subscribing from it', async () => {
    await page.getByLabel('Directory').selectOption('gpodder');
    await page.getByPlaceholder('Search podcasts, or paste an RSS feed URL').fill('');
    const top = page.getByRole('region', { name: 'Most subscribed on gpodder.net' });
    await top.getByText('15,402 subscribers').waitFor();
    await top.getByRole('button', { name: 'Subscribe: Open Source Radio' }).click();
    await top.getByRole('button', { name: 'Subscribed: Open Source Radio' }).waitFor();
    await page.locator('nav').getByText('Open Source Radio').waitFor();
    await page.getByLabel('Directory').selectOption('all');
  });

  await step('an Apple Podcasts link subscribes to the show’s feed', async () => {
    await page.getByPlaceholder('Search podcasts, or paste an RSS feed URL').fill('https://podcasts.apple.com/us/podcast/kernel-panic-hour/id1004');
    await page.getByText('That’s an Apple Podcasts link').waitFor();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Kernel Panic Hour' }).waitFor();
    assert.ok(directoryRequests.some((u) => /^\/apple\/lookup\?id=1004/.test(u)));
  });

  await step('changing the region changes the chart', async () => {
    await page.locator('nav button', { hasText: 'Discover' }).click();
    await page.getByLabel('Region').selectOption('gb');
    await page.getByRole('region', { name: 'Suggested for you' }).getByText('Apple top chart · United Kingdom').waitFor();
    await page.getByRole('region', { name: 'Suggested for you' }).getByText('The Allotment Hour').waitFor();
    assert.ok(directoryRequests.some((u) => u.startsWith('/apple/gb/rss/toppodcasts/')));
    await shot('15-region');
  });

  await step('long titles and authors stay inside their cards on the Shows grid', async () => {
    await page.locator('nav button', { hasText: 'Discover' }).click();
    await page.getByPlaceholder('Search podcasts, or paste an RSS feed URL').fill(`${base}/long.xml`);
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: /Remarkably Long Podcast Titles/ }).waitFor();
    await page.locator('nav button', { hasText: 'Shows' }).click();
    await page.getByText('Jessica Best (Procyon Podcast Network) with Friends').waitFor();
    const layout = await page.evaluate(() => {
      const grid = document.querySelector('main > div > div:last-child');
      const track = parseFloat(getComputedStyle(grid).gridTemplateColumns.split(' ')[0]);
      return [...grid.children].map((card) => {
        const box = card.getBoundingClientRect();
        const spill = [...card.querySelectorAll('span:not(.tag):not(.h-ring)')].map((t) => t.getBoundingClientRect().right - box.right).filter((d) => d > 0.5);
        return { name: card.textContent, width: box.width, track, spill };
      });
    });
    for (const c of layout) {
      assert.ok(c.width <= c.track + 0.5, `${c.name}: card is ${c.width}px in a ${c.track}px column`);
      assert.deepEqual(c.spill, [], `${c.name}: text spills out of its card`);
    }
    await shot('16-long-names');
  });

  await step('a feed that stops answering cannot wedge refresh', async () => {
    await page.locator('nav button', { hasText: 'Discover' }).click();
    await page.getByPlaceholder('Search podcasts, or paste an RSS feed URL').fill(`${base}/flip.xml`);
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Flip FM' }).waitFor();
    const refresh = page.getByRole('button', { name: 'Refresh all feeds (Ctrl+R)' });
    // The first request answered; every refresh after that hangs until the 2 s timeout gives up.
    for (const round of [1, 2]) {
      await refresh.click();
      await waitFor(`refresh ${round} to ask the feed again`, () => hits['/flip.xml'] >= round + 1);
      await refresh.locator('.ph-arrows-clockwise').waitFor({ timeout: 10000 });
    }
    await page.getByText(/Feeds refreshed.*failed/).first().waitFor();
  });

  await step('a long show mounts only the rows on screen and scrolls to the rest', async () => {
    await page.locator('nav button', { hasText: 'Discover' }).click();
    await page.getByPlaceholder('Search podcasts, or paste an RSS feed URL').fill(`${base}/big.xml`);
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Big Catalogue' }).waitFor();
    const mounted = () => page.locator('.h-row').count();
    await page.getByText('Big episode 600', { exact: true }).waitFor();
    const top = await mounted();
    assert.ok(top > 5 && top < 60, `${top} rows mounted for 600 episodes`);
    await page.evaluate(() => document.querySelector('main').scrollTo(0, 1e7));
    await page.getByText('Big episode 1', { exact: true }).waitFor();
    assert.equal(await page.getByText('Big episode 600', { exact: true }).count(), 0, 'rows scrolled far out of view are unmounted');
    assert.ok(await mounted() < 60, `${await mounted()} rows mounted at the bottom`);
    // Sorting still orders the whole list, not just what was on screen.
    await page.getByLabel('Sort episodes').selectOption('Oldest first');
    await page.evaluate(() => document.querySelector('main').scrollTo(0, 0));
    await page.getByText('Big episode 1', { exact: true }).waitFor();
    assert.equal(await page.getByText('Big episode 600', { exact: true }).count(), 0);
    await shot('17-long-show');
  });

  await step('a runaway response is cut off instead of buffered', async () => {
    await page.locator('nav button', { hasText: 'Discover' }).click();
    await page.getByPlaceholder('Search podcasts, or paste an RSS feed URL').fill(`${base}/huge.xml`);
    await page.keyboard.press('Enter');
    await page.getByText(/Couldn’t add that feed:.*response too large/).waitFor({ timeout: 15000 });
  });

  assert.deepEqual(errors.filter((e) => !/itunes\.apple\.com|ERR_NAME|ERR_TUNNEL|ERR_PROXY/.test(e)), [], 'console errors');
  console.log(`\nAll e2e steps passed. Screenshots: ${shots}`);
} catch (err) {
  await shot('failure').catch(() => {});
  console.error('\n', err, '\nconsole errors:', errors, `\nscreenshots: ${shots}`);
  process.exitCode = 1;
} finally {
  await app.close();
  server.closeAllConnections();
  server.close();
}
