export type FieldElement = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', '']);
const BLOCKED_AUTOCOMPLETE = /\b(cc-|one-time-code|current-password|new-password)/;

/** Is this a plain-text control whose value we read and write directly? */
export function isTextControl(el: Element): el is HTMLTextAreaElement | HTMLInputElement {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type.toLowerCase());
}

/** The outermost contenteditable element containing `el`, or null. */
export function editingHost(el: Element): HTMLElement | null {
  if (!(el instanceof HTMLElement) || !el.isContentEditable) return null;
  let host: HTMLElement = el;
  while (host.parentElement?.isContentEditable) host = host.parentElement;
  return host;
}

/**
 * Resolve the event target to a field Cadenza should check, or null.
 * Never activates on password or payment fields, disabled/read-only fields, or opted-out ones.
 */
export function resolveField(target: EventTarget | null): FieldElement | null {
  if (!(target instanceof Element)) return null;
  const field: FieldElement | null = isTextControl(target) ? target : editingHost(target);
  if (!field) return null;
  if (field.closest('[data-cadenza="off"]')) return null;
  if (isTextControl(field)) {
    if (field.disabled || field.readOnly) return null;
    if (BLOCKED_AUTOCOMPLETE.test(field.autocomplete ?? '')) return null;
  }
  if (field.getAttribute('spellcheck') === 'false' && field.dataset.cadenza !== 'on') {
    // Code editors and similar fields opt out of spellcheck; treat that as opting out of us.
    return null;
  }
  return field;
}
