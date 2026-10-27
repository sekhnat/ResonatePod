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
      <div role="note" className="secret-notice">
        <span className="secret-notice-why">{WHY[status!.backend] ?? WHY.unknown}</span>
        <span className="secret-notice-what">It would be saved as plain text in ~/.config/Resonate/secrets.json.</span>
        <label className="secret-notice-agree">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />Save it anyway
        </label>
      </div>
    ) : null,
  };
}
