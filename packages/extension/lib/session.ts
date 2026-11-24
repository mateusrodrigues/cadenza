import { splitParagraphs } from '@cadenza/engine/paragraphs';
import type { CheckMessage, CheckResponse, Suggestion } from '@cadenza/shared';
import { browser } from 'wxt/browser';
import { type FieldElement, isTextControl } from './fields';
import { HighlightRenderer } from './render-highlights';
import { OverlayRenderer } from './render-overlay';
import type { Renderer } from './renderer';
import { buildTextMap } from './text-map';

const DEBOUNCE_MS = 700;
let nextFieldId = 1;

/**
 * One editable field Cadenza is watching: reads its text after the user pauses, asks the
 * worker for suggestions, and draws them if the text hasn't changed in the meantime.
 */
export class FieldSession {
  readonly fieldId = `f${nextFieldId++}`;
  private readonly renderer: Renderer;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestSeq = 0;
  private lastCheckedText: string | null = null;
  private readonly onInput = () => {
    this.renderer.revalidate();
    this.schedule();
  };
  private readonly onBlur = () => this.schedule(0);

  constructor(
    readonly field: FieldElement,
    private readonly onError: (error: { kind: string; message: string }) => void,
  ) {
    this.renderer = isTextControl(field)
      ? new OverlayRenderer(field)
      : new HighlightRenderer(field);
    field.addEventListener('input', this.onInput);
    field.addEventListener('blur', this.onBlur);
    this.schedule(0);
  }

  private readText(): string {
    return isTextControl(this.field) ? this.field.value : buildTextMap(this.field).text;
  }

  private schedule(delay = DEBOUNCE_MS): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), delay);
  }

  private async check(): Promise<void> {
    const text = this.readText();
    if (text === this.lastCheckedText) return;
    const seq = ++this.requestSeq;
    const paragraphs = splitParagraphs(text);
    const message: CheckMessage = { type: 'cadenza/check', fieldId: this.fieldId, paragraphs };

    let response: CheckResponse;
    try {
      response = (await browser.runtime.sendMessage(message)) as CheckResponse;
    } catch {
      return; // Extension was reloaded or the worker is unavailable; next edit will retry.
    }
    // Ignore results for text that has since changed; a newer check is already scheduled.
    if (seq !== this.requestSeq || this.readText() !== text) return;
    if (!response.ok) {
      if (!response.cancelled) this.onError(response.error);
      return;
    }
    this.lastCheckedText = text;
    this.draw(response.suggestions);
  }

  private draw(suggestions: Suggestion[]): void {
    this.renderer.render(suggestions);
  }

  destroy(): void {
    clearTimeout(this.timer);
    this.field.removeEventListener('input', this.onInput);
    this.field.removeEventListener('blur', this.onBlur);
    this.renderer.destroy();
  }
}
