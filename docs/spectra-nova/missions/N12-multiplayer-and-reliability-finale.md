# N12 — MULTIPLAYER AND RELIABILITY FINALE

**Charters:** Bridge & Sync Engineer + AI Systems Engineer (Designer on call for field/motion tuning under multi-actor load)
**Prerequisites:** N11 accepted in `STATE.md`
**Architecture:** ARCHITECTURE-STORAGE §8, §10; ARCHITECTURE-BRIDGE §5–§9; ARCHITECTURE-FIDELITY §5, §6; ARCHITECTURE-AI §3–§7
**Evidence:** `.shots/missions/N12/` with dual-profile captures, plus chaos and stress run artifacts · **Tier R throughout**, Tier P for the human experience of contention

## Objective

The adapted M9, rebuilt for the Nova product: prove that humans, multiple AIs, several replicas, external Office applications, an unreliable network and a killable Bridge can all operate on the same work without corruption, without lying states, and without the product feeling chaotic. Then write the release verdict.

## Why now

Every mechanism exists and has been verified in isolation. The only thing left to establish is that they hold **together**, under contention, adversarially. This is the mission that decides whether Spectra is releasable.

## The standard

A scenario passes when: no data was lost or silently altered; every state shown during the scenario was true at the moment it was shown; every conflict was precise and resolvable; attribution is correct afterwards; the journal explains what happened; and the experience was legible to the humans involved. "It recovered eventually" is not a pass if the UI lied on the way.

## Workstreams (ordered)

### W1 — Profiles, presence and permissions (Tier P + R)

1. Two real browser profiles (P owner, C collaborator) per HQ's dual-profile method, on the same work.
2. Sharing: grant, downgrade, revoke — including mid-session and mid-run. A read-only collaborator's client cannot mutate, and AI acting for them cannot either (A2 enforced server-side; prove with a negative test).
3. Presence: join, leave, selection, idle, reconnect; the field expresses collaborator loci per N11 without noise.
4. Permission change during an active file sync and during an AI run — both must resolve safely and honestly.

### W2 — True merge and contention per type (Tier R)

1. Concurrent human editing across all nine types, with type-appropriate contention: text co-typing in Document and Code, cell contention in Sheets, object contention in Presentation and Whiteboard, question contention in Quiz, card contention in Flashcards, field contention in Planner and Agent.
2. Actor-scoped undo integrity after concurrent edits, AI edits, and external transactions.
3. Leases and claims where sharing is meaningless: dropdown ownership, drag ownership, resize, chart manipulation, object movement, and the native-file write/commit phase. A second actor is blocked gracefully with a legible reason, never by a silent no-op.
4. Do not add locking where CRDT merge is naturally safe — verify the current boundary is still correct after N7's depth, and adjust deliberately if not.

### W3 — AI × collaboration (Tier R)

1. P's AI visible to C with correct identity and colour; C's AI visible to P; two AIs from two accounts on one artifact.
2. An AI waiting on a human-held target: pauses, reports honestly in the dock, resumes when released — and the reverse (a human interrupting an AI-held region).
3. Steering and stopping while collaborating; reconnect mid-run on either side; a run whose target is deleted or moved by someone else mid-flight.
4. Exactly one followed AI per user, independently chosen by each user, with no cross-user viewport interference.
5. AI performing a file-effect action while a collaborator edits the same work — confirmation, ordering and status all correct.

### W4 — Replicas under multiplayer (Tier R)

1. Two humans editing a mounted DOCX through Spectra while Word opens and saves the same file: the external transaction reconciles, both surfaces update in place, attribution distinguishes all three sources.
2. Bridge disconnected while collaboration continues; local replica falls `behind`; on reconnect it catches up without clobbering anything (I7).
3. Two devices each holding a local replica of collaboratively edited work; a conflict is produced deliberately and resolved precisely.
4. A conflict raised while an AI run is mid-operation, and a conflict raised while a collaborator is mid-drag.
5. Collaboration continuing while the local replica is entirely unavailable (drive removed), then returning.

### W5 — Chaos and the failure catalogue re-run (Tier R)

1. Re-run the full ARCHITECTURE-STORAGE §10 matrix from N6 under multiplayer conditions rather than single-user, and record any behaviour that differs.
2. Bridge chaos: kill during write, during scan, during upload, during reconciliation; corrupt the journal file and prove safe recovery or honest refusal; revoke credentials mid-operation; simulate antivirus locking, disk full and clock skew.
3. Network chaos: partition the gateway, partition Convex, partition the Bridge's cloud channel independently; slow links; repeated reconnect storms.
4. Adversarial ordering: replay a stale revision, deliver events out of order, double-deliver an idempotent op, and deliver an op for revoked access.
5. Assert on the journal in every case — the journal is the evidence, the screenshots are the experience.

### W6 — Load and endurance (Tier R + P)

1. Sustained multi-actor session (target: 4 humans + 3 AIs across several works, including one mounted Office file) for a long run; watch memory, rAF, socket churn, Convex bandwidth and journal growth.
2. A large mount (target 25k files) with continuous external churn while collaboration proceeds.
3. Endurance: leave the product open for hours with the Bridge connected and an idle field; confirm idle budgets still hold (N11 budgets) and nothing leaks.

### W7 — The final marathons and the verdict (Tier P)

1. Four marathons, each a real sustained workflow with real data: a general project; a school workflow on real ManageBac data; an agent workflow; and a collaboration-heavy workflow with mounted Office files.
2. A free-use session with a second person if possible; otherwise dual-profile with genuine parallel work.
3. Empty STATE §4/§5 of Nova-era UNKNOWNs: everything is VERIFIED, precisely defected, or explicitly deferred with a reason.
4. Write the **release verdict** in STATE for Pablo: what is releasable, to whom, with which known limitations; what must not be promised; and the specific list of things that would need to be true before the local/Office capabilities are offered to users outside a controlled group.

## Invariants to uphold

Every storage invariant (I1–I8) under contention. A1/A2 for every actor including collaborators' AIs. D26 (no lying states — this is the mission that hunts them), D28, D38 (one followed AI per user), D40. No last-write-wins anywhere, in any scenario, ever.

## Out of scope

New capability of any kind · provider adapters · visual identity changes (N11 is closed; log findings instead) · anything that would require rewriting a finished mission (stop and ask Pablo per PLAYBOOK §9).

## Acceptance gates

1. **F8 passes** in full: two humans plus two AIs across a mounted artifact and the Library, claims holding, one followed AI per user, an external Word save mid-session reconciling. Dual-profile evidence with intermediate frames.
2. Every W1–W4 scenario recorded in STATE with dual-profile evidence and a journal excerpt where relevant.
3. Chaos suite green, including journal-corruption recovery, credential revocation mid-op, and the adversarial ordering set; every failure mode produced an honest state (screenshots of the honest states, not just passing tests).
4. §10 matrix re-run under multiplayer with differences documented.
5. Load and endurance results recorded with numbers; idle budgets from N11 still met after hours of uptime.
6. All P-flows and all F-flows (F1–F8) pass fresh on both profiles.
7. Office harness green; close-out checks green; no secrets (E13 status re-stated for Pablo).
8. STATE §4/§5 emptied of Nova-era UNKNOWNs; **release verdict written**; mission log ≤40 lines.
