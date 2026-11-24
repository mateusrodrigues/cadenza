import { defineContentScript } from 'wxt/utils/define-content-script';
import { type FieldElement, resolveField } from '../lib/fields';
import { FieldSession } from '../lib/session';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main(ctx) {
    const sessions = new Map<FieldElement, FieldSession>();

    const watch = (target: EventTarget | null) => {
      const field = resolveField(target);
      if (!field || sessions.has(field)) return;
      sessions.set(field, new FieldSession(field));
    };
    // composedPath() reaches fields inside open shadow roots.
    const onFocusIn = (event: Event) => watch(event.composedPath()[0] ?? event.target);

    // Drop sessions whose field left the page.
    const sweep = setInterval(() => {
      for (const [field, session] of sessions) {
        if (!field.isConnected) {
          session.destroy();
          sessions.delete(field);
        }
      }
    }, 5000);

    document.addEventListener('focusin', onFocusIn, true);
    // A field focused before this script loaded (autofocus, or a quick click) sent its
    // focusin already.
    watch(deepActiveElement());
    ctx.onInvalidated(() => {
      clearInterval(sweep);
      document.removeEventListener('focusin', onFocusIn, true);
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
