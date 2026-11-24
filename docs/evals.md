# Eval results

How the checker performs on the labeled corpus in `evals/`. The method, the corpus format and
the scoring rules are in [`evals/README.md`](../evals/README.md). Model names here are the ids
the providers returned; this is an internal engineering document, not product copy.

All runs: 2026-11-24, explanations off, every category enabled, `en-US` unless the sample says
otherwise. The corpus has 205 samples: 101 labeled correctness mistakes, 20 clarity, 16 style,
10 tone, and 64 clean samples (851 words), including 5 prompt-injection samples.

## Current prompt (v3)

| Model (provider)               | Samples | Correctness precision | Overall precision | Clean false positives / 500 words | Correctness found / fixed | Clarity | Style | Tone | p50 / p95   |
| ------------------------------ | ------- | --------------------- | ----------------- | --------------------------------- | ------------------------- | ------- | ----- | ---- | ----------- |
| `claude-haiku-5-5` (Anthropic) | 205     | **100%**              | **100%**          | **0**                             | 98% / 98%                 | 85%     | 88%   | 80%  | 1.1 / 1.8 s |

Phase 3 exit target for recommended hosted models: correctness precision ≥ 85% and ≤ 1 false
positive per 500 words of clean text. **Met.**

Latency was measured with 4 requests at a time; a single check is likely a little faster.

## Local model

| Model (server)                      | Prompt | Samples                | Correctness precision | Overall precision | Clean false positives / 500 words | Correctness found / fixed | p50 / p95    |
| ----------------------------------- | ------ | ---------------------- | --------------------- | ----------------- | --------------------------------- | ------------------------- | ------------ |
| `phi4-14b` (llama.cpp, CPU, Q4_K_M) | v2     | 71 (every third)       | 94%                   | 87%               | 5.1 (3 in 293 words)              | 97% / 94%                 | 44 / 95 s ¹  |
| `phi4-14b` (llama.cpp, CPU, Q4_K_M) | v1     | 37 (spelling, partial) | 97%                   | 97%               | –                                 | 100% / 97%                | 58 / 137 s ¹ |

¹ 4 requests at a time on one CPU; the server's throughput was ~17–30 s per sample.

phi4 is accurate on mistakes but noisier on clean text: it reworded a correct "principle",
rewrote parts of a prompt-injection sample (without following the injected instruction), and
added synonyms next to real fixes ("came to" → "attended"). It's usable in slow model mode
for occasional checks, not for live underlines. It hasn't been run on prompt v3 yet (a full
run takes hours on this machine).

## Recommended models

| Use                   | Model                          | Why                                                                                    |
| --------------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| Hosted, live checking | `claude-haiku-5-5` (Anthropic) | Meets the exit target with room to spare; ~1 s per check                               |
| Local, CPU only       | `phi4-14b`, slow model mode    | Accurate on mistakes; expect ~5 false positives per 500 words and ~1 min per paragraph |

Only measured models are listed. OpenAI, Gemini, OpenRouter, Mistral, Groq and the other
presets haven't been run (no keys here), and no small (≤ 8B) local model has been tried yet.
To add one: `CADENZA_EVAL_API_KEY=… npm run eval -- --preset <preset> --model <id>`.

## Prompt history (`claude-haiku-5-5`, all 205 samples)

| Prompt | Change                                                                                                                   | Correctness precision | Clean FP / 500 words | Clarity | Style | Tone |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------- | -------------------- | ------- | ----- | ---- |
| v1     | Phase 1 prompt                                                                                                           | 94%                   | 1.2                  | 70%     | 100%  | 90%  |
| v2     | Leave correct text alone ("whom", "data is", quote style, casual chat); every mistake; one fix per problem; compact JSON | 100%                  | 0                    | 70%     | 56%   | 50%  |
| v3     | The leave-alone rule scoped to correctness; clarity, style and tone told what to look for                                | 100%                  | 0                    | 85%     | 88%   | 80%  |

v1 was also hurt by an engine bug (below), so some of the v1 → v2 precision gain is the fix.

## Engine fixes found by the evals

- **Rewrites were split into word fragments.** A rewrite such as "suggested me to apply" →
  "suggested that I apply" became "me" → "that" and "to" → "I", each wrong on its own (and
  accepting one in the UI would garble the text). Now only correctness rewrites are split, and
  only where unchanged words separate the changes; clarity, style and tone rewrites stay whole.
- **Dense short paragraphs ran out of output tokens** and failed the whole check. The output
  budget now starts at 1,024 tokens, and the complete suggestions of a cut-off response are
  kept.
- **Local servers sampled at temperature 0.8** (llama.cpp's default). Local endpoints now get
  temperature 0; hosted ones are left alone (some reasoning models reject a temperature).
- **Compact JSON** cut phi4's output from ~77 to ~48 tokens per suggestion, about 40% faster
  on CPU.

## Known gaps

- Recall on wordy phrases ("make a decision about", "end result") and some clichés ("Last but
  not least") is uneven; tone has only 10 samples, so its percentages move a lot per sample.
- The second mistake in a sentence is sometimes missed ("The informations you sent were
  helpful" → only "information" is fixed).
- Explanations on: not measured yet (costs more output tokens; affects local speed most).
- The corpus is hand-written by the team. Real-world text (emails, comments, docs) will be
  needed before claiming these numbers hold in the wild.
