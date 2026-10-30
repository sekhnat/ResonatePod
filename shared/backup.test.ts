import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, readBackup, summarise, type LibraryBackup } from './backup';

const good = (): LibraryBackup => ({
  format: BACKUP_FORMAT, version: 1, app: '1.7.0', createdAt: Date.UTC(2026, 9, 30),
  library: {
    shows: [
      { id: 'kp', title: 'Kernel Panic Hour', eps: [{ guid: 'kp:ep:42', pubDate: 5, title: 'Wayland' }, { guid: 'kp:ep:41', pubDate: 4 }] },
      { id: 'empty', eps: [] },
    ],
    epState: { 'kp:kp:ep:42': { played: true, pos: 12.5, inbox: false, file: '/home/u/Podcasts/KP/42.mp3', fileBytes: 10 } },
    kv: { folder: '~/Podcasts', queue: ['kp:kp:ep:42'] },
  },
  notes: [{ show: 'kp', guid: 'kp:ep:42', text: 'Screen sharing.' }],
});

describe('readBackup', () => {
  it('accepts a backup and says what is in it', () => {
    const b = good();
    expect(readBackup(JSON.parse(JSON.stringify(b)))).toEqual(b);
    expect(summarise(b, 'x.resonate-backup')).toEqual({ name: 'x.resonate-backup', app: '1.7.0', createdAt: b.createdAt, shows: 2, episodes: 2 });
  });

  it('turns away files that are not backups, and ones a newer Resonate made', () => {
    expect(() => readBackup(null)).toThrow('isn’t a Resonate backup');
    expect(() => readBackup({ shows: [] })).toThrow('isn’t a Resonate backup');
    expect(() => readBackup({ ...good(), version: 2 })).toThrow('newer version of Resonate');
    expect(() => readBackup({ ...good(), version: 0 })).toThrow('damaged');
  });

  it('turns away a backup with a record the library couldn’t hold, naming what is wrong', () => {
    const broken = (change: (b: LibraryBackup) => void) => { const b = good(); change(b); return () => readBackup(b); };
    expect(broken((b) => { delete (b as Partial<LibraryBackup>).library; })).toThrow('damaged (no library)');
    expect(broken((b) => { b.library.shows[0].id = 'a:b'; })).toThrow('damaged (show 1)'); // ids never hold ':'
    expect(broken((b) => { b.library.shows[1].id = 'kp'; })).toThrow('show kp twice');
    expect(broken((b) => { (b.library.shows[0] as { eps: unknown }).eps = 'none'; })).toThrow('damaged (show kp)');
    expect(broken((b) => { b.library.shows[0].eps[0].pubDate = 'today' as never; })).toThrow('an episode of kp');
    expect(broken((b) => { b.library.shows[0].eps[1].guid = ''; })).toThrow('an episode of kp');
    expect(broken((b) => { b.library.epState['kp:kp:ep:42'].pos = 'x' as never; })).toThrow('episode state kp:kp:ep:42');
    expect(broken((b) => { b.library.epState['kp:kp:ep:42'].file = 5 as never; })).toThrow('episode state');
    expect(broken((b) => { b.notes.push({ show: 'kp' } as never); })).toThrow('damaged (show notes)');
    expect(broken((b) => { (b as { notes: unknown }).notes = undefined; })).toThrow('no show notes');
  });
});
