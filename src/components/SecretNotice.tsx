import { useEffect, useState } from 'react';
import type { SecretStatus } from '../../shared/types';
import { platform } from '../platform';

const WHY: Record<string, string> = {
  none: 'This computer can’t encrypt passwords.',
  basic_text: 'No desktop keyring (GNOME Keyring or KWallet) is running, so passwords can’t be properly protected.',
  unknown: 'Resonate can’t tell whether a desktop keyring is available.',
  browser: 'The browser version keeps passwords in local storage.',
};

/**
 * Where a password is about to be kept. With a desktop keyring it is encrypted; without one it would sit in a file
 * that anyone with access to your files could read, so the dialog says so and waits for a yes before saving.
 * `blocked` is true until that is settled (the answer arrives in a moment), and `secure` only once it is known to be safe.
 */
export function useSecretConsent() {
  const [status, setStatus] = useState<SecretStatus | null>(null);
  const [agreed, setAgreed] = useState(false);
  useEffect(() => {
    let live = true;
    platform.secretStatus().then((s) => { if (live) setStatus(s); }, () => { if (live) setStatus({ secure: false, backend: 'unknown' }); });
    return () => { live = false; };
  }, []);
  const insecure = !!status && !status.secure;
  return {
    secure: status?.secure === true,
    blocked: !status || (insecure && !agreed),
    notice: insecure ? (
      <div role="note" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 'var(--radius-md)', background: 'var(--color-neutral-900)', fontSize: 12.5, lineHeight: 1.45 }}>
        <span style={{ color: 'var(--color-accent-300)' }}>{WHY[status!.backend] ?? WHY.unknown}</span>
        <span style={{ color: 'var(--color-neutral-300)' }}>It would be saved as plain text in ~/.config/Resonate/secrets.json.</span>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--color-text)', cursor: 'pointer' }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />Save it anyway
        </label>
      </div>
    ) : null,
  };
}
