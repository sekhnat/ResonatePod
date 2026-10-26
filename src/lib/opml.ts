export interface OpmlFeed {
  title: string;
  xmlUrl: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function exportOpml(feeds: OpmlFeed[], now = new Date()): string {
  const lines = feeds.map((f) => `    <outline type="rss" text="${esc(f.title)}" title="${esc(f.title)}" xmlUrl="${esc(f.xmlUrl)}"/>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    '    <title>Resonate subscriptions</title>',
    `    <dateCreated>${now.toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
    ...lines,
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
}

/** Returns every outline that carries a feed URL, at any nesting depth. */
export function parseOpml(xml: string): OpmlFeed[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Not a valid OPML file');
  const out: OpmlFeed[] = [];
  for (const el of Array.from(doc.getElementsByTagName('outline'))) {
    const xmlUrl = el.getAttribute('xmlUrl');
    if (!xmlUrl) continue;
    out.push({ xmlUrl, title: el.getAttribute('title') || el.getAttribute('text') || titleFromUrl(xmlUrl) });
  }
  return out;
}

export function titleFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^(www|feeds?|rss)\./, '');
    const base = host.split('.')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return url;
  }
}

export function isFeedUrl(s: string): boolean {
  return /^https?:\/\/\S+\.\S+/.test(s.trim());
}

export function downloadText(filename: string, text: string, type = 'text/x-opml') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
