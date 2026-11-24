import { splitParagraphs } from '@cadenza/engine/paragraphs';
import type { Paragraph, Suggestion } from '@cadenza/shared';
import { browser } from 'wxt/browser';
import { FieldBadge } from './badge';
import { type FieldElement, isTextControl } from './fields';
import type { CheckMessage, CheckResponse, ForgetMessage } from './messages';
import { HighlightRenderer } from './render-highlights';
import { OverlayRenderer } from './render-overlay';
import type { Renderer } from './renderer';
import { buildTextMap, offsetOf } from './text-map';

const DEBOUNCE_MS = 700;
const SLOW_DEBOUNCE_MS = 1500;
let nextFieldId = 1;

/**
 * One editable field Cadenza is watching: reads its text after the user pauses, asks the
 * worker for suggestions, and draws them if the text hasn't changed in the meantime.
 */
export class FieldSession {
  readonly fieldId = `f${nextFieldId++}`;
  private readonly renderer: Renderer;
  private readonly badge: FieldBadge;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestSeq = 0;
  /** Text whose check completed with nothing pending; no need to ask again. */
  private settledText: string | null = null;
  /** Set from worker responses: the active provider is slow, so wait longer after typing. */
  private slow = false;
  private readonly onInput = () => {
    this.renderer.revalidate();
    this.schedule();
  };
  private readonly onBlur = () => this.schedule(0);

  constructor(readonly field: FieldElement) {
    this.renderer = isTextControl(field)
      ? new OverlayRenderer(field)
      : new HighlightRenderer(field);
    this.badge = new FieldBadge(field);
    field.addEventListener('input', this.onInput);
    field.addEventListener('blur', this.onBlur);
    this.schedule(0);
  }

  private readText(): string {
    return isTextControl(this.field) ? this.field.value : buildTextMap(this.field).text;
  }

  /** Offset of the caret in the field text, if the caret is inside the field. */
  private caretOffset(): number | null {
    if (isTextControl(this.field)) {
      return document.activeElement === this.field ? this.field.selectionStart : null;
    }
    const sel = this.field.ownerDocument.getSelection();
    if (!sel?.focusNode || !this.field.contains(sel.focusNode)) return null;
    return offsetOf(buildTextMap(this.field), sel.focusNode, sel.focusOffset);
  }

  private schedule(delay = this.slow ? SLOW_DEBOUNCE_MS : DEBOUNCE_MS): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), delay);
  }

  private async check(): Promise<void> {
    const text = this.readText();
    if (text === this.settledText) return;
    const seq = ++this.requestSeq;
    const paragraphs = splitParagraphs(text);
    const message: CheckMessage = {
      type: 'cadenza/check',
      fieldId: this.fieldId,
      paragraphs,
      priority: caretParagraph(paragraphs, this.caretOffset()),
    };

    this.badge.set({ kind: 'checking' });
    let response: CheckResponse;
    try {
      response = (await browser.runtime.sendMessage(message)) as CheckResponse;
    } catch {
      // Extension reloaded or worker unavailable; the next edit retries.
      this.badge.set({ kind: 'idle' });
      return;
    }
    // A newer check superseded this one; it owns the badge now.
    if (seq !== this.requestSeq) return;
    if (this.readText() !== text) {
      this.badge.set({ kind: 'idle' });
      return;
    }
    if (!response.ok) {
      this.badge.set(
        response.cancelled ? { kind: 'idle' } : { kind: 'error', message: response.error.message },
      );
      return;
    }
    this.slow = response.slow;
    this.draw(response.suggestions);
    if (response.pending > 0) {
      // Slow mode checks one paragraph per request; continue with the rest.
      this.badge.set({ kind: 'checking' });
      this.schedule(0);
    } else {
      this.settledText = text;
      this.badge.set({ kind: 'done', suggestions: response.suggestions });
    }
  }

  private draw(suggestions: Suggestion[]): void {
    this.renderer.render(suggestions);
  }

  destroy(): void {
    clearTimeout(this.timer);
    this.field.removeEventListener('input', this.onInput);
    this.field.removeEventListener('blur', this.onBlur);
    this.renderer.destroy();
    this.badge.destroy();
    const forget: ForgetMessage = { type: 'cadenza/forget', fieldId: this.fieldId };
    browser.runtime.sendMessage(forget).catch(() => {});
  }
}

function caretParagraph(paragraphs: Paragraph[], caret: number | null): string[] {
  if (caret === null) return [];
  const p = paragraphs.find((p) => caret >= p.start && caret <= p.start + p.text.length);
  return p ? [p.pid] : [];
}
