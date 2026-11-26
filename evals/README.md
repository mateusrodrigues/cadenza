# Evals

A labeled corpus and a runner that sends it through Cadenza's real checking pipeline
(`@cadenza/engine` + `@cadenza/providers`) and scores what comes back. Every prompt change is
measured here before it ships, per model. Precision comes first: a noisy checker gets
uninstalled.

## Corpus

`corpus.jsonl`, one sample per line:

```json
{
  "id": "confused-04",
  "text": "Their going to love the new design.",
  "issues": [{ "original": "Their", "category": "correctness", "fix": ["They're", "They are"] }]
}
```

- `issues[].original` is the exact span (`occurrence` picks the Nth appearance).
- `fix` lists the accepted replacements. They're enforced for correctness issues only;
  clarity, style and tone have no single right answer, so any suggestion on the span counts.
- `optional: true` marks a matter of taste (Oxford comma, "cancelled"): a suggestion there
  counts neither for nor against the model.
- Samples with no required issue are **clean**: every suggestion on them is a false positive.
  They include traps: correctly used homophones, code identifiers, URLs, names, British
  spelling under `"dialect": "en-GB"`, informal chat.
- `inject-*` samples contain instructions aimed at the model; it must ignore them.

`npm test` checks that every label is found in its text and that a model returning exactly
the labeled fixes scores 100%.

## Scoring

Each suggestion is one of:

| Verdict     | Meaning                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------ |
| `tp`        | Overlaps a labeled issue; for correctness, applying it turns the text into an accepted fix |
| `wrong_fix` | Overlaps a correctness issue, but the replacement isn't an accepted fix                    |
| `neutral`   | Overlaps only an optional span                                                             |
| `fp`        | Overlaps nothing labeled                                                                   |

Fixes are compared on the whole text after applying the suggestion, so a model may pick a
wider or narrower span than the label (`"Their going"` → `"They're going"` counts).

- **Precision** = tp / (tp + wrong_fix + fp). Reported overall and for suggestions the model
  labeled correctness.
- **Recall** per labeled category: share of issues found (any suggestion overlapping) and, for
  correctness, fixed.
- **Clean false positives per 500 words** of clean text.
- Latency p50/p95 and output tokens. Latency is only meaningful with `--concurrency 1`.

Phase 3 exit target on recommended hosted models: correctness precision ≥ 0.85 and ≤ 1 false
positive per 500 words of clean text.

## Running

```bash
# Local server (no key)
npm run eval -- --preset llamacpp --base-url http://127.0.0.1:8360/v1 --model <model id>

# Hosted: the key is read only from the environment, never from the command line
CADENZA_EVAL_API_KEY=… npm run eval -- --preset openai --model <model id from the provider>
```

Options: `--every 3` (a balanced third of the corpus, for quick prompt iterations),
`--filter clean-` (id prefix), `--limit N`, `--concurrency N`, `--explanations`, `--out file`,
`--resume file` (continue an interrupted run), `--rescore file` (re-score saved results after
editing labels), `--reasoning-effort none` (OpenAI-compatible presets only: sends
`reasoning_effort`, for example to turn Ollama thinking off), `--max-tokens N` and
`--temperature T` (OpenAI-compatible presets only: replace the engine's output limit and the
provider's temperature). The extension never sends any of these. `--thinking on|off` runs the
checks the way the extension does with its thinking switch for a model that thinks.
Results go to `evals/results/` (not committed); summaries worth keeping go in `docs/evals.md`.
