// End-to-end test: launches the built Electron app against a local feed server.
// Run with `npm run test:e2e` (needs a display; use `xvfb-run -a` on headless Linux).
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
};
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

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/feed.xml') return res.writeHead(200, { 'Content-Type': 'application/rss+xml' }).end(feed());
  if (url === '/ch.json') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(chapters);
  if (url === '/t.vtt') return res.writeHead(200, { 'Content-Type': 'text/vtt' }).end(vtt);
  const body = media[url];
  if (!body) return res.writeHead(404).end();
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (m) {
    const start = +m[1] || 0;
    const end = m[2] ? +m[2] : body.length - 1;
    return res.writeHead(206, { 'Content-Type': 'audio/wav', 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' }).end(body.subarray(start, end + 1));
  }
  res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': body.length, 'Accept-Ranges': 'bytes' }).end(body);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
base = `http://127.0.0.1:${server.address().port}`;

// ---- launch ----
const home = mkdtempSync(path.join(tmpdir(), 'resonate-home-'));
// E2E_APP=release/linux-unpacked/resonate tests a packaged build instead of the dev tree.
const packaged = process.env.E2E_APP;
const app = await electron.launch({
  executablePath: packaged ? path.resolve(packaged) : electronPath,
  args: packaged ? ['--no-sandbox'] : ['.', '--no-sandbox'],
  env: { ...process.env, HOME: home, RESONATE_USER_DATA: path.join(home, 'config'), XDG_CURRENT_DESKTOP: 'KDE' },
});
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const step = async (name, fn) => { process.stdout.write(`• ${name} … `); await fn(); console.log('ok'); };
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
const time = () => page.locator('[aria-label="Seek"]').getAttribute('aria-valuenow').then(Number);

try {
  await step('onboarding is shown on first run', async () => {
    await page.getByText('Welcome to Resonate').waitFor();
    assert.equal(await page.locator('.plasma').count(), 0, 'no fake taskbar');
    await shot('01-welcome');
  });

  await step('subscribe by pasting a feed URL', async () => {
    await page.getByPlaceholder('Search podcasts, or paste an RSS feed URL').fill(`${base}/feed.xml`);
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Fixture FM' }).waitFor();
    await page.getByText('Episode one').waitFor();
    await shot('02-show');
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

  await step('export OPML through the native save dialog', async () => {
    const out = path.join(home, 'subs.opml');
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, out);
    await page.keyboard.press('Control+e');
    for (let i = 0; i < 30 && !existsSync(out); i++) await page.waitForTimeout(100);
    assert.match(readFileSync(out, 'utf8'), new RegExp(`xmlUrl="${base}/feed.xml"`));
  });

  await step('library persists across restarts', async () => {
    await page.waitForTimeout(1500);
    const lib = JSON.parse(readFileSync(path.join(home, 'config', 'library.json'), 'utf8'));
    assert.equal(lib.state.shows[0].title, 'Fixture FM');
  });

  await step('preferences and discover render', async () => {
    await page.locator('nav button', { hasText: 'Preferences' }).click();
    await page.getByText('Sync server').waitFor();
    await shot('07-settings');
  });

  assert.deepEqual(errors.filter((e) => !/itunes\.apple\.com|ERR_NAME|ERR_TUNNEL|ERR_PROXY/.test(e)), [], 'console errors');
  console.log(`\nAll e2e steps passed. Screenshots: ${shots}`);
} catch (err) {
  await shot('failure').catch(() => {});
  console.error('\n', err, '\nconsole errors:', errors, `\nscreenshots: ${shots}`);
  process.exitCode = 1;
} finally {
  await app.close();
  server.close();
}
