import { defineContentScript } from 'wxt/utils/define-content-script';
import { type FieldElement, resolveField } from '../lib/fields';
import { FieldSession } from '../lib/session';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main(ctx) {
    const sessions = new Map<FieldElement, FieldSession>();

    const onFocusIn = (event: Event) => {
      // composedPath() reaches fields inside open shadow roots.
      const field = resolveField(event.composedPath()[0] ?? event.target);
      if (!field || sessions.has(field)) return;
      sessions.set(field, new FieldSession(field));
    };

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
    ctx.onInvalidated(() => {
      clearInterval(sweep);
      document.removeEventListener('focusin', onFocusIn, true);
      for (const s of sessions.values()) s.destroy();
      sessions.clear();
    });
  },
});
