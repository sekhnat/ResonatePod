import { useStore } from '../store';
import { platform } from '../platform';
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
