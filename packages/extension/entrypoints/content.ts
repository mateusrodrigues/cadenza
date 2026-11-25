import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { type FieldElement, resolveField } from '../lib/fields';
import type { KeyboardMessage, RefreshMessage } from '../lib/messages';
import { FieldSession } from '../lib/session';
import { unsupportedEditor } from '../lib/sites';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main(ctx) {
    // Not in editors Cadenza can't work in yet (Google Docs): watch nothing, read nothing.
    if (unsupportedEditor(location.href)) return;
    const sessions = new Map<FieldElement, FieldSession>();

    const watch = (target: EventTarget | null) => {
      // Orphaned by a reload or update of Cadenza: reading isInvalid runs the cleanup below.
      if (ctx.isInvalid) return;
      const field = resolveField(target);
      if (!field || sessions.has(field)) return;
      sessions.set(field, new FieldSession(field));
    };
    // composedPath() reaches fields inside open shadow roots.
    const onFocusIn = (event: Event) => watch(event.composedPath()[0] ?? event.target);

    // Drop sessions whose field left the page. ctx.setInterval also notices, within a few
    // seconds, when Cadenza was reloaded, and runs the cleanup (old underlines and badges go).
    ctx.setInterval(() => {
      for (const [field, session] of sessions) {
        if (!field.isConnected) {
          session.destroy();
          sessions.delete(field);
        }
      }
    }, 5000);

    // The worker asks for a recheck when settings change (site turned on, word added…), and
    // relays the keyboard shortcut to every frame of the tab; only the focused one acts on it.
    const onMessage = (message: unknown, sender: { id?: string }) => {
      if (ctx.isInvalid || sender.id !== browser.runtime.id) return;
      const type = (message as RefreshMessage | KeyboardMessage | null)?.type;
      if (type === 'cadenza/refresh') {
        for (const [field, session] of sessions) if (field.isConnected) session.refresh();
      } else if (type === 'cadenza/keyboard' && document.hasFocus()) {
        // Focus is in a field, or in a card or panel we opened from it.
        if (document.activeElement?.localName === 'cadenza-ui') {
          for (const session of sessions.values()) {
            if (session.hasPopover()) session.openFromKeyboard();
          }
          return;
        }
        const field = resolveField(deepActiveElement());
        if (!field) return;
        watch(field);
        sessions.get(field)?.openFromKeyboard();
      }
    };
    browser.runtime.onMessage.addListener(onMessage);

    document.addEventListener('focusin', onFocusIn, true);
    // A field focused before this script loaded (autofocus, or a quick click) sent its
    // focusin already.
    watch(deepActiveElement());
    ctx.onInvalidated(() => {
      document.removeEventListener('focusin', onFocusIn, true);
      browser.runtime.onMessage.removeListener(onMessage);
      for (const s of sessions.values()) s.destroy();
      sessions.clear();
    });
  },
});

function deepActiveElement(): Element | null {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}
