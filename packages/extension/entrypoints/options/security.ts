import {
  forgetSealedKeys,
  type LockState,
  lock,
  lockState,
  removePassphrase,
  setPassphrase,
  unlock,
} from '../../lib/secrets';
import { $, say } from './dom';

const MIN_LENGTH = 8;

/** Shows the card for the current lock state (Passphrase tab); returns the state. */
export async function renderSecurity(): Promise<LockState> {
  const state = await lockState();
  $('set-passphrase').hidden = state !== 'none';
  $('passphrase-actions').hidden = state !== 'unlocked';
  $('locked').hidden = state !== 'locked';
  return state;
}

/** `changed` runs after the lock state changes (the page reloads its settings). */
export function wireSecurity(changed: () => Promise<void>) {
  const message = $('security-message');
  const fresh = $<HTMLInputElement>('new-passphrase');
  const repeat = $<HTMLInputElement>('repeat-passphrase');

  $('set-passphrase').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (fresh.value.length < MIN_LENGTH) {
      return say(message, `Use at least ${MIN_LENGTH} characters.`, 'error');
    }
    if (fresh.value !== repeat.value) {
      return say(message, 'The two passphrases don’t match.', 'error');
    }
    say(message, 'Encrypting…');
    await setPassphrase(fresh.value);
    fresh.value = '';
    repeat.value = '';
    say(
      message,
      'Keys encrypted. Keep the passphrase somewhere safe: it can’t be recovered.',
      'ok',
    );
    await changed();
  });

  $('lock-now').addEventListener('click', async () => {
    await lock();
    say(message, '');
    await changed();
  });

  $('remove-passphrase').addEventListener('click', async () => {
    await removePassphrase();
    say(message, 'Passphrase removed. Keys are stored unencrypted again.', 'ok');
    await changed();
  });

  const lockedInput = $<HTMLInputElement>('locked-passphrase');
  const lockedMessage = $('locked-message');
  $('locked').addEventListener('submit', async (e) => {
    e.preventDefault();
    lockedMessage.textContent = '';
    if (await unlock(lockedInput.value)) {
      lockedInput.value = '';
      await changed();
    } else {
      lockedMessage.textContent = 'That passphrase didn’t match. Try again.';
      lockedInput.select();
    }
  });

  $('forget-keys').addEventListener('click', async () => {
    const sure = window.confirm(
      'Delete the encrypted API keys? Your providers stay, but you will need to enter their keys again.',
    );
    if (!sure) return;
    await forgetSealedKeys();
    await changed();
  });
}
