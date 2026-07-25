# G-02 Owner-specific AI presence on shared artifacts

Date: 2026-07-26. Status: repair implemented; retest in progress.

## Reproduction

P asked AI to add concise IB exam tips to sections 1.1 and 1.2 of the shared
document while C watched.

- Ack/progress appeared promptly.
- The real content streamed to C and the run completed successfully.
- Across 1.5 s captures and a subsequent 300 ms high-frequency window, both
  profiles reported only `1 collaborator present`.
- No owner-specific AI avatar, cursor, or active-region trace appeared.
- AI absence was therefore **Alarming** under G-02 even though the edit itself
  succeeded.

Evidence `01`–`17` records before, early progress, apply, and completion states.

## Root cause and repair

The gateway already preserved `actorKind`, run/operation identity, active
regions, and bounded cursor metadata. The remaining defect was lifecycle
timing: the AI opened its Hocuspocus connection only for the final Yjs
transaction and destroyed it immediately after acknowledgment, allowing the
awareness entry to be created and removed between browser frames.

Repair:

- establish AI awareness before mutation and give it a bounded broadcast window;
- keep the presence legible through completion before teardown;
- publish a distinct cyan AI cursor;
- use owner-specific names in the requested format (`{name}'s AI`);
- render AI through the same collaborator/cursor system with distinct Sparkles
  treatment.

A reverse-direction C-owned run was started for retest (`23`–`24`). The Chrome
control connection reset during high-frequency observation; the run itself was
not interrupted. A fresh clean two-direction retest is still required before
G-02 can be graded Excellent.

