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

  it('leaves out the Podcasting 2.0 fields a feed doesn’t have', () => {
    for (const k of ['persons', 'funding', 'location', 'license', 'podcastGuid']) expect(f).not.toHaveProperty(k);
    for (const k of ['season', 'epNum', 'episodeType', 'persons', 'soundbites', 'location']) expect(f.episodes[2]).not.toHaveProperty(k);
  });

  describe('Podcasting 2.0 tags', () => {
    const p20 = parseFeed(xml
      .replace('<channel>', `<channel>
        <podcast:guid>917393e3-1b1e-5cef-ace4-edaa54e1f810</podcast:guid>
        <podcast:person href="https://ines.example/" img="https://ines.example/me.jpg">Ines Varga</podcast:person>
        <podcast:person role="Host" img="file:///etc/passwd" href="javascript:alert(1)">Tom Achebe</podcast:person>
        <podcast:person role="editor" group="Post-Production">Sam Cut</podcast:person>
        <podcast:person> </podcast:person>
        <podcast:funding url="https://patreon.example/kp">Back us on Patreon</podcast:funding>
        <podcast:funding url="https://ko-fi.example/kp"/>
        <podcast:funding url="ftp://nope.example/">Not a web page</podcast:funding>
        <podcast:location geo="geo:52.52,13.40">Berlin, Germany</podcast:location>
        <podcast:license url="https://creativecommons.org/licenses/by/4.0/">cc-by-4.0</podcast:license>`)
      .replace('<guid isPermaLink="false">kp:ep:42</guid>', `<guid isPermaLink="false">kp:ep:42</guid>
        <podcast:season name="Desktop">3</podcast:season>
        <podcast:episode display="Ch. 42">42.5</podcast:episode>
        <itunes:season>9</itunes:season>
        <podcast:person role="guest" href="https://guest.example/">Pat Guest</podcast:person>
        <podcast:soundbite startTime="1200" duration="45.5">Fractional scaling, explained</podcast:soundbite>
        <podcast:soundbite startTime="73.5" duration="30"/>
        <podcast:soundbite startTime="-4" duration="30">Before the start</podcast:soundbite>
        <podcast:soundbite startTime="100" duration="0">No length</podcast:soundbite>
        <podcast:location>Studio B</podcast:location>`)
      .replace('<guid>https://kernelpanic.example/41</guid>', `<guid>https://kernelpanic.example/41</guid>
        <itunes:season>3</itunes:season><itunes:episode>41</itunes:episode><itunes:episodeType>full</itunes:episodeType>`)
      .replace('<title>The init wars, revisited</title>', '<title>The init wars, revisited</title><itunes:episodeType>Bonus</itunes:episodeType><itunes:episode>x</itunes:episode>'));
    const [a, b, c] = p20.episodes;

    it('reads the show’s people, keeping only web links and pictures', () => {
      expect(p20.persons).toEqual([
        { name: 'Ines Varga', role: 'host', group: 'cast', img: 'https://ines.example/me.jpg', href: 'https://ines.example/' },
        { name: 'Tom Achebe', role: 'host', group: 'cast' },
        { name: 'Sam Cut', role: 'editor', group: 'post-production' },
      ]);
    });

    it('reads funding, location, license and the podcast GUID', () => {
      expect(p20.funding).toEqual([{ url: 'https://patreon.example/kp', label: 'Back us on Patreon' }, { url: 'https://ko-fi.example/kp', label: 'Support the show' }]);
      expect(p20.location).toBe('Berlin, Germany');
      expect(p20.license).toEqual({ name: 'cc-by-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' });
      expect(p20.podcastGuid).toBe('917393e3-1b1e-5cef-ace4-edaa54e1f810');
    });

    it('reads season and episode numbers, preferring podcast: tags over itunes: ones', () => {
      expect(a).toMatchObject({ season: 3, epNum: 42.5 });
      expect(b).toMatchObject({ season: 3, epNum: 41 });
      expect(b).not.toHaveProperty('episodeType'); // "full" is the default, so it isn't kept
      expect(c.episodeType).toBe('bonus');
      expect(c).not.toHaveProperty('epNum'); // not a number
    });

    it('gives an episode its own people only when it names some', () => {
      expect(a.persons).toEqual([{ name: 'Pat Guest', role: 'guest', group: 'cast', href: 'https://guest.example/' }]);
      expect(b).not.toHaveProperty('persons');
    });

    it('reads soundbites in order, dropping ones without a valid start and length', () => {
      expect(a.soundbites).toEqual([{ at: 73.5, dur: 30, title: '' }, { at: 1200, dur: 45.5, title: 'Fractional scaling, explained' }]);
      expect(a.location).toBe('Studio B');
    });
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

  it('parses a feed whose DOCTYPE defines nested entities quickly, with nothing inflated', () => {
    // Ten levels of ten: a parser that expanded &lol9; would produce ten billion characters. (Both the old and the new
    // fast-xml-parser leave this form alone, so this is a smoke test, not proof of the advisories' fixes.)
    const levels = Array.from({ length: 9 }, (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i || ''};`.repeat(10)}">`).join('');
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">${levels}]><rss version="2.0"><channel><title>&lol9;</title><description>x</description></channel></rss>`;
    const started = performance.now();
    let title: string | undefined;
    try { title = parseFeed(bomb).title; } catch { /* refusing it is fine too */ }
    expect(performance.now() - started).toBeLessThan(1000);
    expect((title ?? '').length).toBeLessThan(1_000_000);
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
