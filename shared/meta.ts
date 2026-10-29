import { plainText } from './plain-text';
import type { Chapter, TranscriptLine } from './types';

/** Podcasting 2.0 JSON chapters (https://github.com/Podcastindex-org/podcast-namespace/blob/main/chapters/jsonChapters.md). */
export function parseJsonChapters(json: string): Chapter[] {
  const data = JSON.parse(json) as { chapters?: { startTime?: number; title?: string; toc?: boolean }[] };
  return (data.chapters ?? [])
    .filter((c) => typeof c.startTime === 'number' && c.toc !== false)
    .map((c) => ({ t: c.title?.trim() || 'Chapter', at: c.startTime! }))
    .sort((a, b) => a.at - b.at);
}

const ts = (s: string) => {
  const [hms, frac = '0'] = s.trim().replace(',', '.').split('.');
  const parts = hms.split(':').map(Number);
  return parts.reduce((a, p) => a * 60 + p, 0) + parseFloat('0.' + frac);
};

const SPEAKER = /^([A-Z][\w .'-]{0,30}):\s+([\s\S]*)$/;

interface Cue { at: number; who: string; text: string }

/** WebVTT or SRT cues. Handles `<v Speaker>` voice tags and `Speaker: text` prefixes. */
function parseCues(src: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of src.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').filter(Boolean);
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    let body = lines.slice(ti + 1).join(' ');
    let who = '';
    const voice = /<v(?:\.[^ >]+)?\s+([^>]+)>/.exec(body);
    if (voice) who = voice[1].trim();
    body = body.replace(/<[^>]+>/g, '').trim();
    const named = SPEAKER.exec(body);
    if (!who && named) { who = named[1]; body = named[2]; }
    if (body) cues.push({ at: ts(lines[ti].split('-->')[0]), who, text: body });
  }
  return cues;
}

function parseJsonTranscript(src: string): Cue[] {
  const data = JSON.parse(src) as { segments?: { speaker?: string; startTime?: number; body?: string }[] };
  return (data.segments ?? [])
    .filter((s) => typeof s.startTime === 'number' && s.body)
    .map((s) => ({ at: s.startTime!, who: s.speaker ?? '', text: s.body!.trim() }));
}

/** Joins word- or phrase-level cues into readable lines: one per speaker turn or sentence run. */
function mergeCues(cues: Cue[]): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let lastWho = '';
  for (const c of cues) {
    const prev = out[out.length - 1];
    const who = c.who || lastWho;
    const sameSpeaker = prev && (!c.who || c.who === prev.who);
    if (prev && sameSpeaker && !/[.!?…]["”']?$/.test(prev.text) && prev.text.length < 220) {
      prev.text += ' ' + c.text;
    } else {
      out.push({ at: c.at, who, text: c.text });
    }
    lastWho = who;
  }
  return out;
}

/** Podcasting 2.0 HTML transcripts: `<cite>Speaker:</cite> <time>0:01:02</time> <p>Text</p>`. */
function parseHtmlTranscript(src: string): { cues: Cue[]; timed: boolean } | null {
  const re = /<(cite|time|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const cues: Cue[] = [];
  let who = '';
  let at = 0;
  let timed = false;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const body = plainText(m[2]);
    const tag = m[1].toLowerCase();
    if (tag === 'cite') who = body.replace(/:\s*$/, '');
    else if (tag === 'time') { if (/^\d+(:\d+)*([.,]\d+)?$/.test(body)) { at = ts(body); timed = true; } }
    else if (body) {
      const named = !who && SPEAKER.exec(body);
      cues.push(named ? { at, who: named[1], text: named[2] } : { at, who, text: body });
    }
  }
  return cues.length ? { cues, timed } : null;
}

/** Untimed text: one line per paragraph, with `Name:` prefixes as speakers. */
function parseParagraphs(src: string): Cue[] {
  return plainText(src).split(/\n\s*\n|\n(?=[A-Z][\w .'-]{0,30}:\s)/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).map((p) => {
    const named = SPEAKER.exec(p);
    return named ? { at: 0, who: named[1], text: named[2] } : { at: 0, who: '', text: p };
  });
}

export interface Transcript { lines: TranscriptLine[]; timed: boolean }

export function parseTranscript(src: string, type = ''): Transcript | null {
  const t = type.toLowerCase();
  const trimmed = src.trimStart();
  if (t.includes('json') || trimmed.startsWith('{')) return timedOf(parseJsonTranscript(src));
  if (t.includes('vtt') || t.includes('srt') || t.includes('subrip') || src.includes('-->')) return timedOf(parseCues(src));
  if (t.includes('html') || /^<(!doctype|html|body|p|div|cite|time)\b/i.test(trimmed)) {
    const html = parseHtmlTranscript(src);
    if (html) return html.timed ? timedOf(html.cues) : untimed(html.cues);
    return untimed(parseParagraphs(src));
  }
  if (t.includes('text') || !t) return untimed(parseParagraphs(src));
  return null;
}

const timedOf = (cues: Cue[]): Transcript | null => (cues.length ? { lines: mergeCues(cues.sort((a, b) => a.at - b.at)), timed: true } : null);
const untimed = (cues: Cue[]): Transcript | null => (cues.length ? { lines: cues.map((c) => ({ at: 0, who: c.who, text: c.text })), timed: false } : null);
