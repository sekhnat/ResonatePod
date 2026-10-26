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
    expect(parseTranscript(readFileSync('test/fixtures/transcript.vtt', 'utf8'), 'text/vtt')).toEqual([
      { at: 1, who: 'Tom', text: 'Welcome back to Kernel Panic Hour.' },
      { at: 4, who: 'Tom', text: 'Ines, you promised me a calm week.' },
      { at: 8, who: 'Ines', text: 'Let’s start with Wayland.' },
    ]);
  });

  it('reads SRT with "Name:" speaker prefixes', () => {
    const srt = '1\n00:00:01,500 --> 00:00:03,000\nAiko: Rain is hard to record.\n\n2\n00:00:03,000 --> 00:00:05,000\nIt clips.\n';
    expect(parseTranscript(srt, 'application/x-subrip')).toEqual([
      { at: 1.5, who: 'Aiko', text: 'Rain is hard to record.' },
      { at: 3, who: 'Aiko', text: 'It clips.' },
    ]);
  });

  it('reads Podcasting 2.0 JSON transcripts', () => {
    const json = JSON.stringify({ segments: [{ speaker: 'Dev', startTime: 0.5, body: 'Linkers' }, { speaker: 'Dev', startTime: 1, body: 'are fine.' }] });
    expect(parseTranscript(json, 'application/json')).toEqual([{ at: 0.5, who: 'Dev', text: 'Linkers are fine.' }]);
  });

  it('returns null for untimed formats', () => {
    expect(parseTranscript('<p>hello</p>', 'text/html')).toBeNull();
  });
});
