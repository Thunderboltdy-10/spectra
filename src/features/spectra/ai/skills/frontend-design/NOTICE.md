# Anthropic frontend-design adaptation

`SKILL.md` in this folder is a modified adaptation of Anthropic's frontend-design skill, used under
the Apache License 2.0 in `LICENSE.txt` beside this file.

- Source: https://github.com/anthropics/skills/blob/33375500bcea98d610eb30ce10ac4e59b89c390d/skills/frontend-design/SKILL.md
- License: https://github.com/anthropics/skills/blob/33375500bcea98d610eb30ce10ac4e59b89c390d/skills/frontend-design/LICENSE.txt
- Upstream SKILL.md SHA-256: `d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3`.
  License SHA-256: `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594`.
  Both re-checked on 2026-10-04 against the copy in the Claude Code frontend-design plugin.

## Modifications

The guidance is rewritten in our own words and condensed for Spectra's sandboxed widgets, embeds
and code visualisations. It keeps the upstream ideas of subject-led design, structure as
information, purposeful typography, motion that answers people, restraint and self-review. It
removes the studio framing, the calibration list of generated-design traits, the client
confirmation step and CSS-specificity advice. It adds Spectra's theme variables, the sandbox and
size rules, accessible controls and a worked example.

It replaces `src/features/spectra/artifacts/skills/artifact-design.ts` and the notice that lived
in `public/skills/licenses/anthropic-frontend-design/`. Attribution does not imply endorsement by
Anthropic.
