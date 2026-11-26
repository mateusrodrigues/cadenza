# Eval results

How the checker performs on the labeled corpus in `evals/`. The method, the corpus format and
the scoring rules are in [`evals/README.md`](../evals/README.md). Model names here are the ids
the providers returned; this is an internal engineering document, not product copy.

All runs: 2026-11-24, explanations off, every category enabled, `en-US` unless the sample says
otherwise. The corpus has 205 samples: 101 labeled correctness mistakes, 20 clarity, 16 style,
10 tone, and 64 clean samples (851 words), including 5 prompt-injection samples.

## Current prompt (v5; exactly v3 when no writing goals are set)

| Model (provider)               | Samples | Correctness precision | Overall precision | Clean false positives / 500 words | Correctness found / fixed | Clarity | Style | Tone | p50 / p95   |
| ------------------------------ | ------- | --------------------- | ----------------- | --------------------------------- | ------------------------- | ------- | ----- | ---- | ----------- |
| `claude-haiku-5-5` (Anthropic) | 205     | **100%**              | **100%**          | **0**                             | 98% / 98%                 | 85%     | 88%   | 80%  | 1.1 / 1.8 s |

Phase 3 exit target for recommended hosted models: correctness precision ≥ 85% and ≤ 1 false
positive per 500 words of clean text. **Met.**

Latency was measured with 4 requests at a time; a single check is likely a little faster.

## Local model

| Model (server)                                            | Prompt | Samples                | Correctness precision | Overall precision | Clean false positives / 500 words | Correctness found / fixed | p50 / p95    |
| --------------------------------------------------------- | ------ | ---------------------- | --------------------- | ----------------- | --------------------------------- | ------------------------- | ------------ |
| `phi4-14b` (llama.cpp, CPU, Q4_K_M)                       | v3 ²   | 71 (every third)       | 91%                   | 76%               | 10.2 (6 in 293 words)             | 97% / 86%                 | 13 / 26 s    |
| `phi4-14b` (llama.cpp, CPU, Q4_K_M)                       | v2     | 71 (every third)       | 94%                   | 87%               | 5.1 (3 in 293 words)              | 97% / 94%                 | 44 / 95 s ¹  |
| `phi4-14b` (llama.cpp, CPU, Q4_K_M)                       | v1     | 37 (spelling, partial) | 97%                   | 97%               | –                                 | 100% / 97%                | 58 / 137 s ¹ |
| `microsoft/phi-4-reasoning-plus` (LM Studio, CPU, Q4_K_M) | v3 ³   | 71 (every third)       | 79%                   | 62%               | 5.1 (3 in 293 words)              | 97% / 74%                 | 19 / 26 s    |
| `meta-llama-3.1-8b-instruct` (LM Studio, CPU, Q4_K_M)     | v3 ⁴   | 71 (every third)       | 43%                   | 33%               | 68.3 (40 in 293 words)            | 80% / 60%                 | 15 / 16 s    |
| `llama3.2:3b` (Ollama 0.40.18, Apple silicon)             | v3 ⁵   | 71 (every third)       | 35%                   | 38%               | 85.3 (50 in 293 words)            | 97% / 77%                 | –            |

¹ 4 requests at a time on one CPU; the server's throughput was ~17–30 s per sample.
² Run with prompt v4 and no goals set, which is the v3 text exactly; one request at a time.
³ Run 2026-11-26 with prompt v5 and no goals set (the v3 text); one request at a time.
⁴ Run 2026-11-26 with prompt v5 and no goals set (the v3 text); one request at a time,
`json_schema` output. Scored with the deletion guard (below); without it: 40% / 31%, 70.0,
83% / 57%.
⁵ Prompt v5, no goals (the v3 text); from issue #1, before the deletion guard. The engine also
dropped 108 of its suggestions that didn't anchor or changed nothing.

`phi4-14b` is accurate on mistakes but noisier on clean text: it reworded a correct "principle",
rewrote parts of a prompt-injection sample (without following the injected instruction), and
added synonyms next to real fixes ("came to" → "attended"). It's usable in slow model mode
for occasional checks, not for live underlines. On v3 it found more clarity, style and tone
issues than on v2 and, with that, flagged more clean text (10.2 vs 5.1 per 500 words, on the
same samples).

`microsoft/phi-4-reasoning-plus` answered with plain JSON (no reasoning text; ~57 output
tokens per sample) and never failed to parse, but it misuses `""` (delete): 21 of its 66
suggestions were deletions, and 11 of those were wrong. It deleted sentence endings as
"filler" ("afternoon.", "tomorrow.", "last week."), deleted the mistake instead of
fixing it ("the the" → "", "discussed about" → ""), and twice deleted a whole sentence it
thought had a punctuation problem. Accepting any of those would remove the user's text. It
also added a stray quote to a fix ("Their" → "'They're"), changed a correct "principal" to
"principle", and reworded part of a prompt-injection sample ("going to" → "will") without
following the injected instruction. Below the exit target and worse than `phi4-14b` on
the same slice; not recommended. With the deletion guard (below) the same answers score 87%
correctness precision, 74% overall; still the weakest local model measured.

## Small local models

Neither small model measured is usable. `llama3.2:3b` makes 85 false positives per 500 words
of clean text and `meta-llama-3.1-8b-instruct` 68, against a target of 1; fewer than 4 in 10
of either's suggestions are right. The deletion guard barely helps the 8B (70.0 → 68.3 per 500
words, 31% → 33% precision): most of its noise is rewording, not deleting. The 8B returned exactly two edits for 70 of the 71 samples,
clean or not: words deleted ("quarterly" → ""), plain words swapped for fancier ones
("review" → "examination"), and the injected instruction in a prompt-injection sample "fixed"
by deleting it. It also finds and fixes fewer real mistakes than the 3B (80% / 60% vs 97% /
77%).

Many of the 3B's edits make correct text wrong: "This" → "This is" (giving "This is is another
email"), "How" → "How are you doing?" on a sentence that already said it. Ruled out as causes
on the 3B: prompt truncation (~500 tokens in a 32,768 context), sampling (local endpoints get
temperature 0) and the output tier (`json_object` gives the same cards, `prompted` more wrong
ones).

Scratch experiments on the 3B, not shipped:

| Prompt                                                                                                                           | Clean FP / 500 words | Precision | Correctness found / fixed |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------- | ------------------------- |
| v5, unchanged                                                                                                                    | 85.3                 | 38%       | 97% / 77%                 |
| v5 plus three examples (two clean paragraphs → `[]`, one with two mistakes) and "Most paragraphs people write have no mistakes." | 22.2                 | 60%       | 86% / 66%                 |
| The same, with correctness the only category on                                                                                  | 32.4                 | –         | –                         |

With fewer categories, the model labels the same invented edits as correctness, so turning
categories off is no workaround. A filter for edits that repeat an adjacent word ("is is")
caught 13 of 99 wrong suggestions and dropped 3 of 61 right ones. None comes near the target,
so instead of tuning for small models Cadenza warns when one is chosen: onboarding and the
Provider settings say "This model is small" when a local server reports fewer than **9B**
parameters (`SMALL_MODEL_PARAMS` in `packages/extension/lib/model-size.ts`). Sizes come from
the server at runtime: Ollama's `/api/tags` (`details.parameter_size`), LM Studio's
`/api/v1/models` (`params_string`) and llama.cpp's `/v1/models` (`meta.n_params`). vLLM and
hosted providers report no size, so they never get the warning.

The limit sits just above the measured 8B (unusable), so every "8B" model (Ollama reports
8.0–8.2B for the common ones) gets the warning, and below the measured 14B (usable in slow
model mode). 9–13B models haven't been measured; measure one before moving the limit up to
cover them.

## Recommended models

| Use                   | Model                          | Why                                                                                    |
| --------------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| Hosted, live checking | `claude-haiku-5-5` (Anthropic) | Meets the exit target with room to spare; ~1 s per check                               |
| Local, CPU only       | `phi4-14b`, slow model mode    | Accurate on mistakes; expect ~5 false positives per 500 words and ~1 min per paragraph |

Only measured models are listed. OpenAI, Gemini, OpenRouter, Mistral, Groq and the other
presets haven't been run (no keys here). The small local models tried, 3B and 8B, aren't
usable (see above); 9–13B is unmeasured.
To add one: `CADENZA_EVAL_API_KEY=… npm run eval -- --preset <preset> --model <id>`.

## Prompt history (`claude-haiku-5-5`, all 205 samples)

| Prompt | Change                                                                                                                   | Correctness precision | Clean FP / 500 words | Clarity | Style | Tone |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------- | -------------------- | ------- | ----- | ---- |
| v1     | Phase 1 prompt                                                                                                           | 94%                   | 1.2                  | 70%     | 100%  | 90%  |
| v2     | Leave correct text alone ("whom", "data is", quote style, casual chat); every mistake; one fix per problem; compact JSON | 100%                  | 0                    | 70%     | 56%   | 50%  |
| v3     | The leave-alone rule scoped to correctness; clarity, style and tone told what to look for                                | 100%                  | 0                    | 85%     | 88%   | 80%  |

v1 was also hurt by an engine bug (below), so some of the v1 → v2 precision gain is the fix.

## Writing goals (prompts v4 and v5)

Goals (tone and readers, set in settings) add lines to the prompt only when set; with no goals
the text is exactly v3 (`prompt.test.ts` checks this against hashes of the v3 prompts), so the
results above hold for everyone who leaves goals alone. Measured with the strictest
combination: formal tone, general readers.

| Model              | Samples          | Prompt  | Goals           | Correctness precision | Overall precision | Clean false positives / 500 words |
| ------------------ | ---------------- | ------- | --------------- | --------------------- | ----------------- | --------------------------------- |
| `claude-haiku-5-5` | 205              | v3 text | none            | 100%                  | 100%              | 0                                 |
| `claude-haiku-5-5` | 205              | v5      | formal, general | 99%                   | 87%               | 7.6 (13 in 851 words)             |
| `phi4-14b`         | 71 (every third) | v3 text | none            | 91%                   | 76%               | 10.2                              |
| `phi4-14b`         | 71 (every third) | v4      | formal, general | 94%                   | 62%               | 34.1                              |
| `phi4-14b`         | 71 (every third) | v5      | formal, general | 100%                  | 72%               | 18.8                              |

The corpus labels assume no goals, so with a formal goal some "false positives" are the goal
doing its job. v4's lines invited rewording: plain words swapped for fancier ones ("Fewer
people" → "Fewer individuals", "amount of money" → "total funds") and shell commands flagged as
jargon. v5 says to flag only slang, contractions and chatty phrases, to leave code, commands,
names and quotes alone, and never to reword text that already fits the goals. Of v5's 11 clean
flags, 7 are what a formal goal asks for ("I'm" → "I am", "Thanks for joining" → "Thank you
for attending"); the rest are noise ("principal" → "headmaster").

On `claude-haiku-5-5` every one of the 13 clean flags is what the goals ask for: 11 contractions
or chatty phrases ("We're" → "We are", "lol that's" → "That is"), one acronym spelled out for
general readers ("OKRs"), and "To be honest," → "Honestly,". No rewording noise; recall stayed
high (correctness 97%, tone 100%) at 1.1 s p50. **v5 ships.**

Not measured yet: the other goal values (casual, neutral, experts).

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
- **Deletions that removed the user's text.** `microsoft/phi-4-reasoning-plus` answered `""`
  when it had no fix: it deleted "the the" outright, cut "afternoon." off a sentence, and
  deleted whole sentences. The engine now drops a deletion that empties the paragraph, takes a
  sentence's ending punctuation without the rest of the sentence, or (for correctness) spans
  more than one word. Re-scoring the saved runs with the guard (`--rescore --reanchor`; same
  model answers):

  | Run                                   | Correctness precision | Overall precision | Wrong fix + fp | Correctness found |
  | ------------------------------------- | --------------------- | ----------------- | -------------- | ----------------- |
  | `claude-haiku-5-5`, v2, v3, v5 formal | unchanged             | unchanged         | unchanged      | unchanged         |
  | `phi4-14b`, v2                        | 94% → 97%             | 87% → 88%         | 7 → 6          | 97% → 94%         |
  | `phi4-14b`, v3                        | 91% → 94%             | 76% → 77%         | 15 → 14        | 97% → 94%         |
  | `phi4-14b`, v4 / v5 formal            | unchanged             | unchanged         | unchanged      | unchanged         |
  | `microsoft/phi-4-reasoning-plus`, v3  | 79% → 87%             | 62% → 74%         | 24 → 14        | 97% → 86%         |
  | `meta-llama-3.1-8b-instruct`, v3      | 40% → 43%             | 31% → 33%         | 88 → 82        | 83% → 80%         |

  No correct suggestion was dropped in any run. "Found" falls only because a wrong deletion
  used to count as finding the issue it destroyed. "Fixed" is unchanged everywhere except
  the 8B, where it rises (57% → 60%): on "Do you want to come with us." it sent both "us." → ""
  and the right whole-sentence fix, and the overlapping deletion used to win.

## Known gaps

- Recall on wordy phrases ("make a decision about", "end result") and some clichés ("Last but
  not least") is uneven; tone has only 10 samples, so its percentages move a lot per sample.
- The second mistake in a sentence is sometimes missed ("The informations you sent were
  helpful" → only "information" is fixed).
- Explanations on: not measured yet (costs more output tokens; affects local speed most).
- The corpus is hand-written by the team. Real-world text (emails, comments, docs) will be
  needed before claiming these numbers hold in the wild.
