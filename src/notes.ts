import { useEffect, useState } from 'react';
import { platform } from './platform';

/**
 * Show notes are the bulk of a library (about 2 KB an episode, so most of 80 MB for twenty shows of two thousand), and
 * nobody needs more than one episode's at a time. They are never kept on the episodes in the store: a feed's notes wait
 * here until they have been saved with their episode, and after that they are read back from the database, a few at a time.
 */

const key = (show: string, guid: string) => `${show}:${guid}`;

/** Notes from a feed, not yet saved. */
const pending = new Map<string, string>();

const CACHE_SIZE = 40;
/** The notes read most recently (oldest first, so the first key is the one to drop). */
const cache = new Map<string, string>();

const remember = (k: string, text: string) => {
  cache.delete(k);
  cache.set(k, text);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
};

/** Keeps an episode's notes from a feed until they are saved. */
export function holdNotes(show: string, guid: string, text: string | undefined) {
  if (text) pending.set(key(show, guid), text);
}

/** The notes still waiting to be saved for an episode, if any. */
export const heldNotes = (show: string, guid: string) => pending.get(key(show, guid));

/** Their episode has been saved with them: they can be read back from the database from now on. */
export function notesSaved(show: string, guid: string) {
  const k = key(show, guid);
  const text = pending.get(k);
  if (text === undefined) return;
  pending.delete(k);
  remember(k, text);
}

/** A show was removed. */
export function dropNotes(show: string) {
  for (const k of [...pending.keys(), ...cache.keys()]) if (k.startsWith(`${show}:`)) { pending.delete(k); cache.delete(k); }
}

/** An episode's show notes; empty when it has none. */
export async function loadNotes(show: string, guid: string): Promise<string> {
  const k = key(show, guid);
  const held = pending.get(k);
  if (held !== undefined) return held;
  const hit = cache.get(k);
  if (hit !== undefined) { remember(k, hit); return hit; }
  const text = await platform.libNotes(show, guid).catch(() => '');
  remember(k, text);
  return text;
}

/** An episode's notes once `wanted` (null while they load). */
export function useNotes(show: string, guid: string, wanted: boolean): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void loadNotes(show, guid).then((t) => { if (live) setText(t); });
    return () => { live = false; };
  }, [show, guid, wanted]);
  return text;
}

/** For tests. */
export function resetNotes() { pending.clear(); cache.clear(); }
