import { useStore } from '../store';
import { platform } from '../platform';
import { flushSave, startPersistence, stopPersistence } from '../persistence';
import { exportOpml, parseOpml } from './opml';

export async function importOpmlFile() {
  const s = useStore.getState();
  const file = await platform.openOpml();
  if (!file) return;
  let feeds;
  try {
    feeds = parseOpml(file.text);
  } catch (err) {
    s.toast(`Couldn’t import ${file.name}: ${(err as Error).message}`);
    return;
  }
  if (!feeds.length) { s.toast(`No feeds found in ${file.name}`); return; }
  s.toast(`Importing ${feeds.length} feeds from ${file.name}…`);
  const n = await s.importFeeds(feeds);
  useStore.getState().toast(`Imported ${n} of ${feeds.length} feeds`);
  if (n) useStore.getState().go('shows');
}

export async function exportOpmlFile() {
  const s = useStore.getState();
  const name = await platform.saveOpml('resonate-subscriptions.opml', exportOpml(s.shows.map((x) => ({ title: x.title, xmlUrl: x.feedUrl }))));
  if (name) s.toast(`Exported ${s.shows.length} feeds to ${name}`);
}

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;

/** Saves a backup of the library, with what was changed a moment ago in it too. */
export async function backupLibraryFile() {
  useStore.getState().checkpoint(); // the playing episode's position, which is otherwise saved every 30 s
  await flushSave();
  try {
    const r = await platform.backupLibrary();
    if (r) useStore.getState().toast(`Backed up ${plural(r.shows, 'show')} and ${plural(r.episodes, 'episode')} to ${r.name}`);
  } catch (err) {
    useStore.getState().toast(`Couldn’t back up the library: ${(err as Error).message}`);
  }
}

/** Asks for a backup file; the dialog that asks before restoring it shows what it holds. */
export async function chooseBackupFile() {
  const r = await platform.chooseBackup();
  if (!r) return;
  if ('error' in r) { useStore.getState().toast(`Couldn’t read that backup: ${r.error}`); return; }
  useStore.getState().set({ restoreFrom: r, dialog: 'restore' });
}

/**
 * Replaces the library with the chosen backup. The window then starts again on the restored library; until it does,
 * nothing from the library it held is saved, so none of it can be written over what was restored.
 */
export async function restoreBackupFile() {
  const s = useStore.getState();
  s.set({ dialog: null, restoreFrom: null });
  if (s.playing) s.togglePlay();
  await flushSave(); // so the copy kept of the library as it was is up to date
  stopPersistence();
  const r = await platform.restoreBackup().catch((err: Error) => ({ error: err.message }));
  if (r) {
    startPersistence(); // nothing was replaced: carry on saving as before
    useStore.getState().toast(`Couldn’t restore the backup: ${r.error}`);
  }
}
