import { z } from 'zod';
import { CATEGORY_IDS, type Category } from './categories.js';

/**
 * What we ask a model to return. Optional fields are nullable-but-required so the same schema
 * works with strict structured-output modes (which require every property to be listed).
 */
export const ModelSuggestionSchema = z.object({
  pid: z.string(),
  original: z.string().min(1),
  replacement: z.string(),
  category: z.enum(CATEGORY_IDS),
  occurrence: z.number().int().min(1).nullish(),
  subtype: z.string().nullish(),
  explanation: z.string().nullish(),
});
export type ModelSuggestion = z.infer<typeof ModelSuggestionSchema>;

/** Lenient wrapper: items are validated one by one so one bad item doesn't drop the rest. */
export const ModelOutputSchema = z.object({ suggestions: z.array(z.unknown()) });

/**
 * JSON Schema sent to providers, narrowed to the user's settings so constrained decoding can
 * skip work: disabled categories can't be produced, and with explanations off the field is
 * forced to null (saves many output tokens on slow local models).
 * Hand-written and limited to keywords that local servers' grammar converters accept
 * (no `items: false`, `$ref` or `oneOf`).
 */
export function outputJsonSchema(opts: {
  categories: readonly Category[];
  explanations: boolean;
}): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'pid',
            'original',
            'replacement',
            'category',
            'occurrence',
            'subtype',
            'explanation',
          ],
          properties: {
            pid: { type: 'string' },
            original: { type: 'string' },
            replacement: { type: 'string' },
            category: { type: 'string', enum: [...opts.categories] },
            occurrence: { type: ['integer', 'null'] },
            subtype: { type: ['string', 'null'] },
            explanation: opts.explanations ? { type: ['string', 'null'] } : { type: 'null' },
          },
        },
      },
    },
  };
}
