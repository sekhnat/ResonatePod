import { describe, expect, it } from 'vitest';
import { exportOpml, isFeedUrl, parseOpml, titleFromUrl } from './opml';

describe('opml', () => {
  it('round-trips feeds, escaping special characters', () => {
    const feeds = [{ title: 'Margins & Footnotes', xmlUrl: 'https://example.org/feed?a=1&b=2' }];
    expect(parseOpml(exportOpml(feeds))).toEqual(feeds);
  });

  it('finds nested outlines and falls back to text or URL for titles', () => {
    const xml = `<opml><body><outline text="Folder"><outline text="Inner" xmlUrl="https://a.example/rss"/></outline><outline xmlUrl="https://www.podcast.example/x"/></body></opml>`;
    expect(parseOpml(xml)).toEqual([
      { title: 'Inner', xmlUrl: 'https://a.example/rss' },
      { title: 'Podcast', xmlUrl: 'https://www.podcast.example/x' },
    ]);
  });

  it('rejects malformed XML', () => {
    expect(() => parseOpml('<opml><body>')).toThrow();
  });

  it('recognises feed URLs', () => {
    expect(isFeedUrl('https://x.example/feed')).toBe(true);
    expect(isFeedUrl('kernel panic')).toBe(false);
    expect(titleFromUrl('https://feeds.slowarchive.org/rss')).toBe('Slowarchive');
  });
});
