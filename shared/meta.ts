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
    const named = /^([A-Z][\w .'-]{0,30}):\s+(.*)$/.exec(body);
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

export function parseTranscript(src: string, type = ''): TranscriptLine[] | null {
  const t = type.toLowerCase();
  let cues: Cue[];
  if (t.includes('json') || src.trimStart().startsWith('{')) cues = parseJsonTranscript(src);
  else if (t.includes('vtt') || t.includes('srt') || t.includes('subrip') || src.includes('-->')) cues = parseCues(src);
  else return null;
  return cues.length ? mergeCues(cues.sort((a, b) => a.at - b.at)) : null;
}
