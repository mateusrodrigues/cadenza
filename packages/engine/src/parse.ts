import { ModelOutputSchema } from '@cadenza/shared';

/**
 * Parse model output leniently: strips Markdown code fences and surrounding prose, then
 * returns the raw `suggestions` items (validated individually later). Returns null when no
 * usable JSON object is found.
 */
export function parseModelOutput(text: string): unknown[] | null {
  const candidates = [text.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const c of candidates) {
    try {
      const parsed = ModelOutputSchema.safeParse(JSON.parse(c));
      if (parsed.success) return parsed.data.suggestions;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
