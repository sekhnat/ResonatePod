import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { dropNotes, heldNotes, holdNotes, loadNotes, notesSaved, resetNotes } from './notes';
import { platform, type Platform } from './platform';

let libNotes: MockInstance<Platform['libNotes']>;
beforeEach(() => {
  resetNotes();
  libNotes = vi.spyOn(platform, 'libNotes').mockImplementation(async (show, guid) => `notes of ${show}/${guid}`);
});
afterEach(() => vi.restoreAllMocks());

describe('show notes', () => {
  it('are read from the database once, then from a small cache', async () => {
    expect(await loadNotes('a', '1')).toBe('notes of a/1');
    expect(await loadNotes('a', '1')).toBe('notes of a/1');
    expect(libNotes).toHaveBeenCalledTimes(1);
  });

  it('forget the one asked for longest ago when the cache is full', async () => {
    for (let i = 0; i < 40; i++) await loadNotes('a', String(i));
    await loadNotes('a', '0'); // 0 is used again, so 1 is now the oldest
    await loadNotes('a', '40');
    libNotes.mockClear();
    await loadNotes('a', '0');
    expect(libNotes).not.toHaveBeenCalled();
    await loadNotes('a', '1');
    expect(libNotes).toHaveBeenCalledTimes(1);
  });

  it('are served from memory while they wait to be saved, then from the cache once they have been', async () => {
    holdNotes('a', '1', 'fresh from the feed');
    expect(await loadNotes('a', '1')).toBe('fresh from the feed');
    expect(heldNotes('a', '1')).toBe('fresh from the feed');
    notesSaved('a', '1');
    expect(heldNotes('a', '1')).toBeUndefined();
    expect(await loadNotes('a', '1')).toBe('fresh from the feed');
    expect(libNotes).not.toHaveBeenCalled();
  });

  it('are empty for an episode without any, and when they cannot be read', async () => {
    holdNotes('a', '2', undefined);
    holdNotes('a', '3', '');
    expect(heldNotes('a', '2')).toBeUndefined();
    expect(heldNotes('a', '3')).toBeUndefined();
    libNotes.mockRejectedValue(new Error('gone'));
    expect(await loadNotes('a', '9')).toBe('');
  });

  it('go with their show', async () => {
    holdNotes('a', '1', 'held');
    holdNotes('ab', '1', 'other show');
    await loadNotes('a', '2');
    dropNotes('a');
    expect(heldNotes('a', '1')).toBeUndefined();
    expect(heldNotes('ab', '1')).toBe('other show');
    libNotes.mockClear();
    await loadNotes('a', '2');
    expect(libNotes).toHaveBeenCalledTimes(1);
  });
});
