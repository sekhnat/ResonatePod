import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, type LibraryBackup } from '../shared/backup';
import { backupName, decodeBackup, encodeBackup, fitToMachine, type Machine } from './backup';

const backup = (): LibraryBackup => ({
  format: BACKUP_FORMAT, version: 1, app: '1.7.0', createdAt: 1,
  library: {
    shows: [{ id: 'kp', eps: [{ guid: 'a', pubDate: 2 }, { guid: 'b', pubDate: 1 }] }],
    epState: {
      'kp:a': { played: false, pos: 30, inbox: true, file: '/home/u/Podcasts/KP/a.mp3', fileBytes: 100 },
      'kp:b': { played: true, pos: 0, inbox: false, file: '/elsewhere/b.mp3', fileBytes: 200, playedAt: 5 },
    },
    kv: { folder: '/mnt/other', tg: { auto: false, autostart: true }, directory: { country: 'gb', podcastIndex: true }, dlPending: ['kp:a', 'kp:b', 7], queue: ['kp:b'] },
  },
  notes: [{ show: 'kp', guid: 'a', text: 'Notes é \u{1F3A7}' }],
});

describe('backup files', () => {
  it('are gzipped JSON that reads back the same', () => {
    const b = backup();
    const bytes = encodeBackup(b);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    expect(decodeBackup(bytes)).toEqual(b);
  });

  it('can also be plain JSON', () => {
    expect(decodeBackup(Buffer.from(JSON.stringify(backup())))).toEqual(backup());
  });

  it('say what is wrong with a file that isn’t one', () => {
    expect(() => decodeBackup(Buffer.from('<opml/>'))).toThrow('isn’t a Resonate backup');
    expect(() => decodeBackup(gzipSync('{"format":"something-else"}'))).toThrow('isn’t a Resonate backup');
    expect(() => decodeBackup(Buffer.from([0x1f, 0x8b, 1, 2, 3]))).toThrow('could not be unpacked');
  });

  it('are named for the day they are made', () => {
    expect(backupName(new Date(2026, 0, 5))).toBe('resonate-backup-2026-01-05.resonate-backup');
  });
});

describe('fitToMachine', () => {
  const machine = (over: Partial<Machine> = {}): Machine => ({
    hasFile: async (f) => f.startsWith('/home/u/Podcasts/'),
    isDownloadFolder: async (f) => f === '~/Podcasts' || f.startsWith('/home/u/Podcasts'),
    folder: '~/Podcasts',
    autostart: false,
    podcastIndexKey: false,
    ...over,
  });

  it('keeps downloads that are here, and forgets the rest, which then download again', async () => {
    const lib = await fitToMachine(backup(), machine());
    expect(lib.epState['kp:a']).toEqual(backup().library.epState['kp:a']);
    expect(lib.epState['kp:b']).toEqual({ played: true, pos: 0, inbox: false, playedAt: 5 });
    expect(lib.kv.dlPending).toEqual(['kp:b']); // kp:a is downloaded already, and 7 was never a key
  });

  it('keeps this computer’s download folder unless the backup’s is already allowed here', async () => {
    expect((await fitToMachine(backup(), machine())).kv.folder).toBe('~/Podcasts');
    expect((await fitToMachine(backup(), machine({ isDownloadFolder: async () => true }))).kv.folder).toBe('/mnt/other');
    expect((await fitToMachine(backup(), machine({ folder: undefined }))).kv).not.toHaveProperty('folder');
  });

  it('takes start-at-login and the Podcast Index key from this computer', async () => {
    const lib = await fitToMachine(backup(), machine({ autostart: true, podcastIndexKey: false }));
    expect(lib.kv.tg).toEqual({ auto: false, autostart: true });
    expect(lib.kv.directory).toEqual({ country: 'gb', podcastIndex: false });
    const bare = backup();
    bare.library.kv = {};
    expect((await fitToMachine(bare, machine())).kv).toEqual({ folder: '~/Podcasts', tg: { autostart: false }, directory: { podcastIndex: false } });
  });

  it('leaves the backup it was given as it was', async () => {
    const b = backup();
    await fitToMachine(b, machine());
    expect(b).toEqual(backup());
  });
});
