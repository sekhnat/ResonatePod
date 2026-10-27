import { describe, expect, it } from 'vitest';
import { libraryContract } from '../../test/library-contract';
import { MemoryLibrary } from './memory-library';

libraryContract('the in-memory library', () => new MemoryLibrary());

describe('the in-memory library as the browser build saves it', () => {
  it('comes back from its dump', () => {
    const lib = new MemoryLibrary();
    lib.patch({
      shows: { upsert: [{ id: 'a', title: 'A' }] },
      episodes: { upsert: [{ show: 'a', ep: { guid: 'x', pubDate: 5, title: 'X', description: 'notes' } }] },
      epState: { upsert: { 'a:x': { played: true, pos: 1, inbox: false } } },
      kv: { folder: '/x' },
    });
    const again = new MemoryLibrary(JSON.parse(JSON.stringify(lib.dump())));
    expect(again.load()).toEqual(lib.load());
    expect(again.notes('a', 'x')).toBe('notes');
  });
});
