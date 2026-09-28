# B-01 DeepSeek-native provider routing — final

Date: 2026-07-24

## Live QC proof (Tab P)
- Prompt: "Reply with exactly one short sentence confirming you are online. Do not create any artifacts."
- RunId: `ps74z828gp349k2vzbwk71sskd8b4d6n`
- Answer: "I'm online and ready to help."
- `modelUsed`: `deepseek/deepseek-v4-pro`
- `providerUsed`: **DeepSeek** (not Xiaomi/AtlasCloud)
- `usage.elapsedMs`: 2938
- Events: run_created → status "incomplete · retrying once" → progress "Confirming online status" → final

## Grade
**Excellent** — primary DeepSeek provider confirmed on live traffic; no fallback provider used.
