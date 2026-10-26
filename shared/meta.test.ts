import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJsonChapters, parseTranscript } from './meta';

describe('chapters', () => {
  it('reads JSON chapters, dropping ones hidden from the table of contents', () => {
    expect(parseJsonChapters(readFileSync('test/fixtures/chapters.json', 'utf8')).map((c) => c.t)).toEqual([
      'Cold open', 'Why Wayland took so long', 'Screen sharing & portals', 'Fractional scaling, finally',
    ]);
  });
});

describe('transcripts', () => {
  it('reads WebVTT voices and joins cues into sentences', () => {
    expect(parseTranscript(readFileSync('test/fixtures/transcript.vtt', 'utf8'), 'text/vtt')?.lines).toEqual([
      { at: 1, who: 'Tom', text: 'Welcome back to Kernel Panic Hour.' },
      { at: 4, who: 'Tom', text: 'Ines, you promised me a calm week.' },
      { at: 8, who: 'Ines', text: 'Let’s start with Wayland.' },
    ]);
  });

  it('reads SRT with "Name:" speaker prefixes', () => {
    const srt = '1\n00:00:01,500 --> 00:00:03,000\nAiko: Rain is hard to record.\n\n2\n00:00:03,000 --> 00:00:05,000\nIt clips.\n';
    expect(parseTranscript(srt, 'application/x-subrip')?.lines).toEqual([
      { at: 1.5, who: 'Aiko', text: 'Rain is hard to record.' },
      { at: 3, who: 'Aiko', text: 'It clips.' },
    ]);
  });

  it('reads Podcasting 2.0 JSON transcripts', () => {
    const json = JSON.stringify({ segments: [{ speaker: 'Dev', startTime: 0.5, body: 'Linkers' }, { speaker: 'Dev', startTime: 1, body: 'are fine.' }] });
    expect(parseTranscript(json, 'application/json')?.lines).toEqual([{ at: 0.5, who: 'Dev', text: 'Linkers are fine.' }]);
  });

  it('reads timed HTML transcripts (cite / time / p)', () => {
    const html = `<html><body>
      <cite>Ana:</cite><time>0:00:01</time><p>Hello &amp; welcome.</p>
      <cite>Ben:</cite><time>00:01:02.5</time><p>Thanks <b>Ana</b>.</p>
    </body></html>`;
    expect(parseTranscript(html, 'text/html')).toEqual({ timed: true, lines: [
      { at: 1, who: 'Ana', text: 'Hello & welcome.' },
      { at: 62.5, who: 'Ben', text: 'Thanks Ana.' },
    ] });
  });

  it('reads untimed HTML and plain text as paragraphs', () => {
    expect(parseTranscript('<div><p>Ana: Hi there.</p><p>Second thought.</p></div>', 'text/html')).toEqual({ timed: false, lines: [
      { at: 0, who: 'Ana', text: 'Hi there.' }, { at: 0, who: '', text: 'Second thought.' },
    ] });
    expect(parseTranscript('Ana: One.\nBen: Two\nstill Ben.\n\nNarration.', 'text/plain')).toEqual({ timed: false, lines: [
      { at: 0, who: 'Ana', text: 'One.' }, { at: 0, who: 'Ben', text: 'Two still Ben.' }, { at: 0, who: '', text: 'Narration.' },
    ] });
  });

  it('returns null for an empty or unknown transcript', () => {
    expect(parseTranscript('   ', 'text/html')).toBeNull();
    expect(parseTranscript('%PDF', 'application/pdf')).toBeNull();
  });
});
