import { safeStorage } from 'electron';
import { dataFile } from './context';
import { readJsonFile, updateJsonFile } from './files';
import { originOf } from './hops';

// ---------- feed credentials (HTTP Basic, per origin) and the other saved secrets ----------

const credentials = new Map<string, string>();
let ready: Promise<void> = Promise.resolve();

/** Settles once the saved logins are read (the keyring can be slow); what may send a login waits for it. */
export const credentialsReady = () => ready;

/** The login saved for the origin of `url`, as a request header. */
export const authFor = (url: string): Record<string, string> => {
  const c = credentials.get(originOf(url));
  return c ? { Authorization: c } : {};
};

function readSecrets(): Promise<Record<string, string>> {
  return readJsonFile<Record<string, string>>(dataFile('secrets.json'), {});
}
const decrypt = (v: string) => (v.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) : v.slice(6));

/** One change at a time, whole-file, so two logins saved together can't lose one of them. */
export function writeSecret(key: string, value: string | null) {
  return updateJsonFile<Record<string, string>>(dataFile('secrets.json'), {}, (all) => {
    const next = { ...all };
    if (value == null) delete next[key];
    else next[key] = safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(value).toString('base64') : 'plain:' + value;
    return next;
  }, 0o600);
}

export async function readSecret(key: string): Promise<string | null> {
  const v = (await readSecrets())[key];
  try { return v ? decrypt(v) : null; } catch { return null; } // saved on another machine or keyring: as good as not saved
}

/** Starts reading the saved logins. A failure is logged and leaves none, which is what an unreadable keyring means. */
export function loadCredentials(): Promise<void> {
  ready = (async () => {
    for (const [k, v] of Object.entries(await readSecrets())) {
      if (!k.startsWith('auth:')) continue;
      try { credentials.set(k.slice(5), decrypt(v)); } catch { /* unreadable on this machine */ }
    }
  })().catch((err) => console.warn('Saved logins could not be read:', err));
  return ready;
}

/** Remembers (or, with null, forgets) the login for an origin, now and in the saved file. */
export async function setCredential(origin: string, value: string | null) {
  await ready; // the saved logins are still being read, and would overwrite this one
  if (value) credentials.set(origin, value);
  else credentials.delete(origin);
  await writeSecret(`auth:${origin}`, value);
}
