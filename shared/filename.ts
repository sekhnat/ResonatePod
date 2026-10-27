/** One path segment from free text: no separators or control characters, never empty, never just dots. */
export function safeName(s: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what a file name must not keep
  const name = s.replace(/[/\\:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  // A name made only of dots ("." or "..") would walk out of its folder, so it counts as no name at all.
  return /^\.*$/.test(name) ? 'untitled' : name;
}

/** The YYYY-MM-DD (UTC) a downloaded file is named by, or "undated" when the publish date is missing or unusable. */
export function fileDate(pubDate: number): string {
  const t = new Date(pubDate).getTime();
  return pubDate && Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : 'undated';
}

/** Six hex digits derived from `s` (FNV-1a), to tell apart files whose names would otherwise match. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

/** The file name (without extension) a download is saved under: `<date> - <title>`, plus a tag when another episode would share it. */
export function fileStem(pubDate: number, title: string, suffix?: string): string {
  const tag = (suffix ?? '').replace(/[^0-9a-z]/gi, '').slice(0, 16); // it comes from the renderer: keep it to plain characters
  return `${fileDate(pubDate)} - ${safeName(title)}${tag ? ` [${tag}]` : ''}`;
}
