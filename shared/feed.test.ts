import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cadence, parseDuration, parseFeed, plainText } from './feed';

const xml = readFileSync('test/fixtures/feed.xml', 'utf8');

describe('parseFeed', () => {
  const f = parseFeed(xml);

  it('reads channel metadata', () => {
    expect(f.title).toBe('Kernel Panic Hour');
    expect(f.author).toBe('Ines Varga & Tom Achebe');
    expect(f.imageUrl).toBe('https://kernelpanic.example/art.jpg');
    expect(f.link).toBe('https://kernelpanic.example/');
    expect(f.category).toBe('Technology');
    expect(f.description).toBe('Two sysadmins talk through the week in free software & answer mail.');
  });

  it('skips items without audio and sorts newest first', () => {
    expect(f.episodes.map((e) => e.title)).toEqual(['Wayland, five years on', 'Rolling releases vs. the rest of us', 'The init wars, revisited']);
  });

  it('reads enclosures, guids, durations and dates', () => {
    const [a, b, c] = f.episodes;
    expect(a).toMatchObject({ guid: 'kp:ep:42', duration: 4323, enclosureUrl: 'https://cdn.example/kp42.mp3', sizeBytes: 69206016, enclosureType: 'audio/mpeg' });
    expect(a.pubDate).toBe(Date.UTC(2026, 9, 19, 6));
    expect(b.duration).toBe(3840);
    expect(c.guid).toBe('https://cdn.example/kp40.mp3'); // no <guid>: falls back to the enclosure URL
    expect(c.duration).toBe(3480);
  });

  it('reads Podcasting 2.0 chapters and prefers timed transcripts', () => {
    const [a] = f.episodes;
    expect(a.chaptersUrl).toBe('https://kernelpanic.example/42/chapters.json');
    expect(a.transcriptUrl).toBe('https://kernelpanic.example/42.vtt');
    expect(a.transcriptType).toBe('text/vtt');
  });

  it('reads Podlove simple chapters, episode art and HTML notes as text', () => {
    const b = f.episodes[1];
    expect(b.inlineChapters).toEqual([{ t: 'Intro', at: 0 }, { t: 'Why roll?', at: 266.5 }, { t: 'Listener mail', at: 2110 }]);
    expect(b.imageUrl).toBe('https://kernelpanic.example/41.jpg');
    expect(b.description).toBe('Arch, Tumbleweed & friends.\nPicks');
  });

  it('reads itunes:new-feed-url when a publisher moves the feed', () => {
    expect(f.newFeedUrl).toBeUndefined();
    const moved = xml.replace('<channel>', '<channel><itunes:new-feed-url>https://new.example/feed.xml</itunes:new-feed-url>');
    expect(parseFeed(moved).newFeedUrl).toBe('https://new.example/feed.xml');
    expect(parseFeed(xml.replace('<channel>', '<channel><itunes:new-feed-url>javascript:x</itunes:new-feed-url>')).newFeedUrl).toBeUndefined();
  });

  it('rejects things that are not podcast feeds', () => {
    expect(() => parseFeed('<rss><channel>')).toThrow('not valid XML');
    expect(() => parseFeed('<html><body>hi</body></html>')).toThrow('Not a podcast RSS feed');
    expect(() => parseFeed('hello there')).toThrow('Not a podcast RSS feed');
    expect(() => parseFeed('')).toThrow('Not a podcast RSS feed');
  });

  it('rejects a feed that was cut off, instead of parsing it as a shorter one', () => {
    const secondItem = xml.indexOf('<item>', xml.indexOf('<item>') + 1);
    expect(() => parseFeed(xml.slice(0, secondItem + 40))).toThrow('not valid XML');
    expect(() => parseFeed(xml.slice(0, xml.lastIndexOf('</channel>')))).toThrow('not valid XML');
    expect(() => parseFeed(xml.slice(0, -3))).toThrow('not valid XML');
  });

  it('accepts whitespace and comments after the closing tag', () => {
    expect(parseFeed(`${xml}\n\n<!-- cached by the CDN -->\n`).episodes).toHaveLength(f.episodes.length);
  });
});

describe('helpers', () => {
  it('parses durations in every common shape', () => {
    expect(parseDuration('1:02:03')).toBe(3723);
    expect(parseDuration('62:03')).toBe(3723);
    expect(parseDuration('3723.4')).toBe(3723);
    expect(parseDuration('')).toBe(0);
    expect(parseDuration('n/a')).toBe(0);
  });

  it('strips markup', () => {
    expect(plainText('<p>a&nbsp;&amp;&#39;b</p><br/>c')).toBe("a &'b\n\nc");
  });

  it('estimates cadence', () => {
    const day = 86400000;
    expect(cadence([0, 1, 2, 3].map((i) => ({ pubDate: 1e12 - i * 7 * day })))).toBe('Weekly');
    expect(cadence([0, 1, 2, 3].map((i) => ({ pubDate: 1e12 - i * day })))).toBe('Daily');
    expect(cadence([{ pubDate: 1 }])).toBe('Occasional');
  });
});
