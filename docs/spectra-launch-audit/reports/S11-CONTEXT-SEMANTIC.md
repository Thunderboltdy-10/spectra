# S11 current-provider semantic retrieval measurement and proposal

Measured 2026-09-25, against synthetic material only. **No production embedding, schema, provider, or model-selection change.** Coordinator authorized at most 50,000 input tokens and two transient retries; the experiment used 537 input tokens and zero retries.

## Provider compatibility and observed cost

The public [OpenRouter embedding catalog](https://openrouter.ai/api/v1/embeddings/models) lists `openai/text-embedding-3-small`. A real authenticated POST to `https://openrouter.ai/api/v1/embeddings`, pinned to `OpenAI` with fallbacks disabled, returned provider `OpenAI`, model `text-embedding-3-small`, and exactly 256 finite dimensions per item. This verifies gateway support for the requested dimensionality; direct OpenAI documentation alone had not established it.

| Request | Items | Response input tokens | Client elapsed | Response-reported cost |
| --- | ---: | ---: | ---: | ---: |
| Corpus batch | 40 | 509 | 945 ms | $0.00001018 |
| First individual query | 1 | 14 | 269 ms | $0.00000028 |
| Repeated identical query | 1 | 14 | 289 ms | $0.00000028 |
| Total | 42 | 537 | — | $0.00001074 |

The public advertised prompt price was $0.02 per million tokens, matching these response costs. These are API-reported inference costs, not an invoice including credit-purchase fees. The initial batch and subsequent query calls have different payload sizes, so this is not a controlled server cold/warm benchmark. The repeated query does not prove a provider cache hit. No database, browser-memory, production latency or large-corpus claim follows from these three calls.

## Relevance experiment

The corpus has 16 short memories and 24 queries: 12 calibration and 12 held out. Each split contains eight positive requests and four requests for which no memory is relevant. Cases include paraphrases, related concepts, a Spanish formatting preference retrieved by an English request, unrelated factual questions, and same-domain distractors such as a Mars date correction for a question about Martian moons.

For both the current `memoryEmbedding.ts` fingerprint and learned embeddings, cosine ranks all 16 memories. The calibration procedure chooses the highest-recall cutoff with zero irrelevant selections, allowing at most three returned memories. It uses **only calibration labels**. The cutoff is then applied unchanged to the held-out split.

| Method | Calibration positive top-1 | Held-out positive top-1 | Held-out TP / FP / FN at calibrated cutoff |
| --- | ---: | ---: | --- |
| Current deterministic fingerprint | 4/8 | 0/8 | 0 / 0 / 8 |
| OpenAI learned embedding, 256 dimensions | 8/8 | 8/8 | 5 / 0 / 3 |

The learned cutoff was 0.5372175; the fingerprint cutoff was 0.5165162. The learned cutoff retained 100% precision among its five held-out selections but only 62.5% recall. The fingerprint made no held-out selections, so its zero false-positive count is not evidence of useful precision. Learned top-3 recall was 8/8; fingerprint top-3 recall was 5/8. The three learned false negatives were the heliostat paraphrase (0.4931), a histogram/commuting paraphrase (0.4255), and the cross-language preference (0.4387).

**Recommendation: use learned embeddings for candidate ranking, not this small corpus's cosine cutoff as a universal relevance gate.** Threshold selection cannot replace reasoning about whether a remembered fact helps the current request. The result is evidence for a larger applicability evaluation, not a launch acceptance verdict.

## Proposed bounded production contract

1. Keep initial orientation free of memory retrieval. The main agent decides when `retrieve_memory` is useful. No greeting/factual keyword dispatcher and no compulsory embedding call.
2. Add a separate versioned semantic vector field/index for eligible memory, with provider/model/dimension/input-digest metadata. Do not mix existing fingerprint vectors and learned vectors in one search. Generate learned vectors on authorized memory writes through a bounded asynchronous worker; do not block capture or re-embed unchanged text. Query embedding happens only on demanded retrieval.
3. Search a bounded candidate set, then recheck current claim scope/lifecycle and source authority before returning any text. Authorize before relation expansion and never traverse an inaccessible intermediary. Candidate vectors are hints, never grants. Expose source handles and honest unavailable/pending-index status.
4. Preserve a bounded exact fallback for explicitly referenced claims and literal text searches when indexing is pending or the provider is transiently unavailable. Use existing authorized scope indexes with a documented finite candidate limit until an approved literal search index exists. Report truncation; do not silently fill remaining space with unrelated recent memory or expand a hand-written synonym dictionary.
5. Let the existing main-model tool loop adjudicate applicability among a small, clearly labeled candidate result. It may select none. This does not require a separate model pass for every user turn. Record candidates separately from claims actually used, and charge the complete rendered result against the context budget.
6. Before enabling, evaluate a larger frozen corpus with unrelated same-domain queries, preferences, corrections, multilingual requests, stale vectors, revoked sources, missing indexing and long histories. Measure candidate recall, actual-use precision, DB returned bytes, indexing/query costs, provider timeouts and first/repeated latency. Keep explicit and continued specialist selection intact; optional model-directed specialist discovery should reuse the same relevance discipline.

This proposal needs coordinator approval of the schema/worker/tool handoff. No source implementation of it is included here. The synchronous lexical-only eligibility prototype was withdrawn and remains absent from production code.

## Reproduction evidence

Ignored local evidence under `.spectra-local/launch-s11/context/`:

- `semantic-corpus.json`: frozen synthetic memories, labels and split.
- `measure-semantic.mjs`: actual provider call, bounded retries/budget, current fingerprint comparison and calibration procedure. Reads the existing credential privately; never prints it.
- `semantic-measurement.json`: request/model/provider/dimensions/usage/timing plus every ranking.
- `openrouter-embedding-endpoints.json`: public endpoint metadata.

The experiment used RUNTIME's filesystem guard and changed no shared dependency files or product state. The credential and vectors were not committed. The corpus is small and manually labeled; stronger evidence requires held-out expansion, not tuning to the misses above.
