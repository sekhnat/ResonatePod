const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…',
  copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»', middot: '·', bull: '•',
};

const codePoint = (n: number, raw: string) => (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : raw);

/**
 * Decodes character references in one pass: "&#39;", "&#x2019;" and the common named ones. The XML parser leaves numeric
 * references undecoded, and feeds often escape text twice ("&amp;#39;") or put HTML-escaped text in CDATA, so what reaches
 * us still carries them. One pass, so "&amp;lt;" reads "&lt;" and not "<". Unknown names stay as written.
 */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi, (raw, dec?: string, hex?: string, name?: string) => {
    if (dec) return codePoint(parseInt(dec, 10), raw);
    if (hex) return codePoint(parseInt(hex, 16), raw);
    return NAMED[name!.toLowerCase()] ?? raw;
  });
}

/** Strip markup from show notes; the UI renders plain text only. */
export function plainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
