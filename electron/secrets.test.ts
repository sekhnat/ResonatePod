// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { secretStatus } from './secrets';

const storage = (available: boolean, backend?: string) => ({ isEncryptionAvailable: () => available, ...(backend ? { getSelectedStorageBackend: () => backend } : {}) });

describe('whether a saved password is really protected', () => {
  it('is, with a desktop keyring', () => {
    for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) expect(secretStatus(storage(true, backend), 'linux')).toEqual({ secure: true, backend });
  });

  it('is not, when Linux has fallen back to the built-in key every install shares, or cannot tell', () => {
    expect(secretStatus(storage(true, 'basic_text'), 'linux')).toEqual({ secure: false, backend: 'basic_text' });
    expect(secretStatus(storage(true, 'unknown'), 'linux')).toEqual({ secure: false, backend: 'unknown' });
  });

  it('is not, when there is no encryption at all', () => {
    expect(secretStatus(storage(false), 'linux')).toEqual({ secure: false, backend: 'none' });
    expect(secretStatus(storage(false, 'kwallet'), 'linux')).toEqual({ secure: false, backend: 'none' });
  });

  it('is, on systems where the OS keeps the key and there is no backend to ask about', () => {
    expect(secretStatus(storage(true), 'darwin')).toEqual({ secure: true, backend: 'system' });
    expect(secretStatus(storage(true, 'basic_text'), 'win32')).toEqual({ secure: true, backend: 'system' });
  });
});
