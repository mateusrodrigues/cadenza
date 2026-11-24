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

/**
 * Recover the complete suggestions from output cut off by the token limit, e.g.
 * `{"suggestions":[{…},{…},{"pid":"p1","orig` → the first two items. Returns null if not even
 * one item is complete.
 */
export function parseTruncatedOutput(text: string): unknown[] | null {
  const key = text.search(/"suggestions"\s*:\s*\[/);
  if (key === -1) return null;
  const items: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let itemStart = -1;
  for (let i = text.indexOf('[', key) + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) itemStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && itemStart !== -1) {
        try {
          items.push(JSON.parse(text.slice(itemStart, i + 1)));
        } catch {
          // skip a malformed item
        }
        itemStart = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  return items.length > 0 ? items : null;
}
