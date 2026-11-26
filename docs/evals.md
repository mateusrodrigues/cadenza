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

| Model (server)                      | Prompt | Samples                | Correctness precision | Overall precision | Clean false positives / 500 words | Correctness found / fixed | p50 / p95    |
| ----------------------------------- | ------ | ---------------------- | --------------------- | ----------------- | --------------------------------- | ------------------------- | ------------ |
| `gemma4:26b-mlx` (Ollama, MLX, nvfp4), thinking off ³ | v5 ⁴ | 205 | 99% | 96% | 2.4 (4 in 851 words) | 98% / 97% | 0.8 / 2.0 s |
| `gemma4:26b-mlx` (Ollama, MLX, nvfp4), thinking on | v5 ⁴ | 205, 66 failed | 100% ⁵ | 100% ⁵ | 0 (in 694 words) ⁵ | 100% / 100% ⁵ | 4.8 / 13.8 s |
| `gemma4:26b-mlx` (Ollama, MLX, nvfp4), thinking on, `max_tokens` 8,192 ⁶ | v5 ⁴ | 205, 35 failed | 100% ⁵ | 100% ⁵ | 0 (in 769 words) ⁵ | 100% / 100% ⁵ | 5.8 / 41.3 s |
| `gemma4:26b-mlx` (Ollama, MLX, nvfp4), thinking on, `max_tokens` 8,192, temperature 1.0 ⁷ | v5 ⁴ | 205, 1 failed | 98% | 97% | 0.6 (1 in 851 words) | 100% / 98% | 6.4 / 68.4 s |
| `phi4-14b` (llama.cpp, CPU, Q4_K_M) | v3 ²   | 71 (every third)       | 91%                   | 76%               | 10.2 (6 in 293 words)             | 97% / 86%                 | 13 / 26 s    |
| `phi4-14b` (llama.cpp, CPU, Q4_K_M) | v2     | 71 (every third)       | 94%                   | 87%               | 5.1 (3 in 293 words)              | 97% / 94%                 | 44 / 95 s ¹  |
| `phi4-14b` (llama.cpp, CPU, Q4_K_M) | v1     | 37 (spelling, partial) | 97%                   | 97%               | –                                 | 100% / 97%                | 58 / 137 s ¹ |

¹ 4 requests at a time on one CPU; the server's throughput was ~17–30 s per sample.
² Run with prompt v4 and no goals set, which is the v3 text exactly; one request at a time.
³ The eval sent `reasoning_effort: "none"` (`--reasoning-effort none`). The extension now
sends the same with the thinking switch off (see "The thinking switch" below).
⁴ Run 2026-11-26 with no goals set, which is the v3 text exactly. One request at a time on an
Apple M5 Max with 36 GB of memory.
⁵ Of the 139 samples that completed. The other 66 ran out of output tokens while the model was
still thinking, and most of them were clarity, style and tone samples. These numbers are
therefore biased toward easy samples.
⁶ The eval sent `max_tokens: 8192` (`--max-tokens 8192`) instead of the engine's budget.
⁷ Also `temperature: 1` (`--temperature 1`) instead of the 0 that Cadenza sends to local
servers. One run only: at this temperature the results vary between runs, and that variation
is not measured yet.

phi4 is accurate on mistakes but noisier on clean text: it reworded a correct "principle",
rewrote parts of a prompt-injection sample (without following the injected instruction), and
added synonyms next to real fixes ("came to" → "attended"). It's usable in slow model mode
for occasional checks, not for live underlines. On v3 it found more clarity, style and tone
issues than on v2 and, with that, flagged more clean text (10.2 vs 5.1 per 500 words, on the
same samples).

`gemma4:26b-mlx` with thinking off is the first local model that is fast enough for live
underlines (0.8 s p50, faster than the hosted model). Its correctness precision (99%) is close
to `claude-haiku-5-5`, and its one wrong fix is a tense choice ("attends" → "attended", where
the label expects "attend"). The 4 clean false positives are rewording: "amount of" → "total",
"lay" → "place", "take a look" → "take a look at it", and "Whom should I address the letter
to" → "To whom should I address the letter". That is 2.4 per 500 words, above the 1 per 500
words target for hosted models. Style recall is lower (69%). One tone sample failed because the
JSON was not valid, and 11 suggestions were dropped because their text was not in the
paragraph. All 5 prompt-injection samples got only their real fix.

With thinking on, 66 of 205 checks failed. Ollama counts the reasoning against `max_tokens`,
and a short paragraph gets 1,024 tokens, so the model often stopped before it wrote the JSON.
The checks that completed were exact (no false positives), but each one took about 6 times
longer (4.8 s p50, 13.8 s p95). Before the thinking switch, this model failed about one
check in three in the extension.

A larger budget does not fix this. With `max_tokens` 8,192, 35 of 205 checks still used every
token, and each one took 70 to 135 s. The checks that completed used 361 tokens at p50, 2,744
at p95 and 6,058 at most. Only 2 of them used more than 4,096. The failures are loops, not
long thoughts. On `style-01` the reasoning had 704 lines but only 90 different ones, and it
repeated the same candidate fix ("very very" → "very") 80 times until the limit. Cadenza sends
temperature 0 to local servers, and thinking models are known to loop under greedy decoding.
At temperature 1.0, `style-01` (twice) and `clarity-11` finished with a good fix, but took 21
to 53 s and 1,600 to 3,900 tokens.

The full run at temperature 1.0 and 8,192 tokens is the best local result so far. Only 1 of
205 checks failed (`long-err-03`, a loop that still used every token). Clean text got 0.6
false positives per 500 words, which meets the target for hosted models. Recall is close to
`claude-haiku-5-5`: clarity 85%, style 81% and tone 80%, against 85%, 88% and 80%. The clean
false positive was ", then" → "; then". The 2 wrong fixes were "and," → ", and" and a tone
rewrite of "i think the" that dropped the labeled fix "I". The other false positive removed
", but I could be wrong" from a tone sample. All 5 prompt-injection samples got only their real
fix or no suggestion.

Thinking needs a large budget. The checks used 479 tokens at p50, 3,363 at p90, 4,848 at p95
and 7,432 at most. 65 of the 204 completed checks used more than 1,024 tokens, and 16 used more
than 4,096. The time is the cost: 6.4 s at p50, 54 s at p90 and 68 s at p95. Thinking on fits
slow model mode only. Thinking off (0.8 s p50) stays the choice for live underlines.

## The thinking switch

The extension now has a "Think before suggesting" switch in each provider's settings. It
shows only after the chosen model is seen thinking, in the connection test or in a check, and
it is off by default. These runs go through the same code (`--thinking on|off`), on
`gemma4:26b-mlx` with no goals, one request at a time:

| Thinking | Samples          | Correctness precision | Overall precision | Clean false positives / 500 words | Correctness found / fixed | Clarity | Style | Tone | p50 / p95   |
| -------- | ---------------- | --------------------- | ----------------- | --------------------------------- | ------------------------- | ------- | ----- | ---- | ----------- |
| off      | 205              | 99%                   | 97%               | 1.8 (3 in 851 words)              | 98% / 97%                 | 75%     | 69%   | 100% | 0.5 / 0.8 s |
| off      | 71 (every third) | 97%                   | 96%               | 1.7 (1 in 293 words)              | 100% / 97%                | 86%     | 60%   | 100% | 0.5 / 0.8 s |
| on       | 71 (every third) | 100%                  | 100%              | 0 (in 293 words)                  | 100% / 100%               | 86%     | 40%   | 100% | 5.8 / 89 s  |

What the switch does:

- Off: the request sends `reasoning_effort: "none"`. A server that rejects the field gets the
  request again without it, and the field is not sent to it again.
- On: the output limit gets 8,192 more tokens (`THINKING_TOKENS`), and local servers keep
  their own sampling instead of temperature 0 (Ollama: temperature 1, top_k 64, top_p 0.95
  for this model). Turning it on also turns on slow model mode.
- Before the model is seen thinking, nothing is sent, but the output limit already has room
  to think.
- If a thinking reply runs out of tokens, the engine asks once more with thinking off. It was
  not needed in the 71-sample run.

With thinking on, no check failed and nothing on clean text was flagged, but the slowest check
took 147 s. The style numbers rest on 5 issues, so 40% and 60% differ by one issue.

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

- **Ollama's MLX runner failed every check.** It answers any `response_format` with "501
  structured output is unavailable", and a 501 was classed as a server outage. Now a 501 that
  names the output format makes the engine fall back to the next output tier, down to JSON
  asked for in the prompt only.
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

- Thinking models: at temperature 0, `gemma4:26b-mlx` loops on about one check in six even with
  8,192 tokens, and at temperature 1.0 on about one check in 200. The thinking switch avoids
  temperature 0 and retries without thinking, but a server that ignores `reasoning_effort`
  keeps thinking with the smaller "off" budget. Anthropic and Gemini models never show the
  switch yet: their adapters do not report thinking.
- Recall on wordy phrases ("make a decision about", "end result") and some clichés ("Last but
  not least") is uneven; tone has only 10 samples, so its percentages move a lot per sample.
- The second mistake in a sentence is sometimes missed ("The informations you sent were
  helpful" → only "information" is fixed).
- Explanations on: not measured yet (costs more output tokens; affects local speed most).
- The corpus is hand-written by the team. Real-world text (emails, comments, docs) will be
  needed before claiming these numbers hold in the wild.
