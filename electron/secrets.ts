import type { SecretStatus } from '../shared/types';

/** The part of Electron's safeStorage that says how well it can keep a secret. */
interface Storage {
  isEncryptionAvailable(): boolean;
  /** Linux only. */
  getSelectedStorageBackend?: () => string;
}

/**
 * Whether passwords saved now would really be protected. On Linux, Chromium uses the desktop's keyring (libsecret
 * for GNOME, KWallet for KDE) when there is one; without one it falls back to "basic_text", which encrypts with a key
 * that is the same on every machine, which is obfuscation and not protection, and `isEncryptionAvailable()` is still true.
 */
export function secretStatus(storage: Storage, platform: string = process.platform): SecretStatus {
  if (!storage.isEncryptionAvailable()) return { secure: false, backend: 'none' };
  if (platform !== 'linux' || !storage.getSelectedStorageBackend) return { secure: true, backend: 'system' };
  const backend = storage.getSelectedStorageBackend();
  return { secure: backend !== 'basic_text' && backend !== 'unknown', backend };
}
