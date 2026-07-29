# G-02 Owner-specific AI presence on shared artifacts

Date: 2026-07-26. Final grade: **Excellent**.

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

## 2026-07-26 centralized live-operation retest

The earlier document-only/end-refresh approach was rejected and replaced with
one transient awareness protocol for every artifact shape:

- the server publishes minimal JSON-pointer preview patches through AI
  awareness, then performs one durable Yjs transaction;
- peers render those patches locally, without intermediate durable writes or an
  end-of-run refresh;
- the same semantic paths drive native editor traces, cursor anchoring, and
  artifact-card activity;
- AI presence remains owner-specific (`P MD's AI`) and disappears after the
  durable result is acknowledged.

Verified in both profiles on the shared `Enzyme Inhibitors — Study Notes`
document:

- AI joined at 10.14 s and streamed the focused replacement over 1.56 s at a
  readable 170 ms gesture cadence;
- C held `scrollTop=1533` throughout;
- `/blocks/22/text` decorated native ProseMirror block `b23`;
- the AI cursor moved onto block 23 while the block used a low-opacity pulse;
- the visible shared artifact card entered `updating` and displayed
  `AI editing`;
- final text converged in both profiles;
- presence, region decoration, path metadata, and card activity all cleared by
  12.19 s;
- no error, completion banner, whole-studio wash, refresh, or viewport jump.

Evidence:

- `g02-document-native-trace.png`
- `g02-document-stream-partial.png`
- `g02-artifact-card-live-activity.png`
- `g02-document-clean-completion.png`

Focused validation: 45 tests passed across the live preview/path suites;
TypeScript and selected lint are clean. G-02 remains `in_progress` rather than
Excellent until the reverse-owner and reconnect/error variants are rerun.

## Later peer/card rerun

P changed one irreversible-inhibition list item while C remained in the legacy
shared document. C simultaneously showed `P MD's AI`, a moving cursor, live
path `/blocks/15/text`, a native document trace with streamed text, and the
shared card's `AI editing` badge. All signals cleared after the durable value
arrived, without a refresh or completion wash.

The run also exposed an off-screen-target weakness: the grouped list decoration
could leave the cursor near the header when the target was outside the peer
viewport. A generalized idle-view auto-reveal was added at Artifact Studio
level; active user interaction suppresses it.

Additional evidence:

- `g02-document-peer-card-trace.png`
- `g02-document-peer-stream-partial.png`
- `g02-document-peer-clean-final.png`
- `g02-document-offscreen-clean-final.png`

## Final reverse-owner repair and two-direction rerun

The reverse C -> P run exposed a more serious shared-ownership defect after the
durable edit itself succeeded: settlement searched only artifacts owned by the
run owner. A collaborator with an explicit modify grant could therefore write
the correct Yjs/Convex value, but the staged preview and AI effect remained
`updating`; one client retained a partial preview while the other retained a
stale cursor.

The generalized settlement path now:

- derives affected artifacts from the run's recorded operations (input,
  pending target, conflict target, and executed `affected` records), including
  explicitly granted artifacts owned by another account;
- prunes orphan active effects whose referenced run/execution is no longer
  live, while preserving legitimate concurrent AI effects;
- treats AI awareness as a collaborator for its whole lifecycle rather than
  only while `previewPhase=streaming`;
- keeps the AI cursor at its last edited region for the short completion pause,
  then removes it with the awareness connection.

Fresh reverse-owner runs verified:

- P saw `Pablo MD's AI` during `Preparing a live edit` at 9.13 s;
- both profiles showed `Live · 2 here`;
- the AI then moved to and streamed inside document Block 9 on both profiles;
- the target block used the subtle native blue trace while unrelated content
  and scroll position stayed stable;
- a separate human collaborator cursor remained independently visible;
- the full final sentence converged on both clients;
- after completion both clients had zero AI labels and zero
  `data-ai-region` nodes;
- the durable artifact had the full Block 9 value, no active run id/execution
  id, no preview content, and only the intentionally time-bounded settling
  effect (filtered from the UI after expiry).

Final evidence:

- `g02-c-sees-p-ai-cursor-exact-block.png`
- `g02-p-ai-owner-exact-block.png`
- `g02-peer-sees-c-ai-preparing-lifecycle.png`
- `g02-p-sees-c-ai-exact-block-repaired.png`
- `g02-c-ai-owner-exact-block-repaired.png`
- `g02-reverse-owner-clean-final-p.png`
- `g02-reverse-owner-clean-final-c.png`

G-02 is **Excellent**. Reconnect, permission-change, and multi-AI behavior remain
owned by G-08/G-09/G-05 rather than blocking this task's two-direction result.
