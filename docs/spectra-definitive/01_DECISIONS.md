# Decision ledger

| ID | Decision | Rationale | Status |
|---|---|---|---|
| DEC-001 | Fine-grained Yjs is the live editable source of truth. | Editing must merge without whole-snapshot resets. | Accepted |
| DEC-002 | Cloudflare Workers and Durable Objects own the realtime plane; Convex owns durable product state and projections. | Keystrokes must not wait for Convex. | Accepted |
| DEC-003 | Collaboration uses mergeable state, interaction leases, and structural claims. | Coordination must be narrow and semantic. | Accepted |
| DEC-004 | Library and Workspace share one workbench session but remain distinct browser surfaces. | Navigation must preserve open work without collapsing product concepts. | Accepted |
| DEC-005 | Calendar is an application surface; Plan remains a work type. | Official time, tasks, and scheduled blocks require separate semantics. | Accepted |
| DEC-006 | Memory is a conservative background system, not normal navigation. | Users need privacy controls, not a curation inbox. | Accepted |
| DEC-007 | AI runs use a versioned action protocol and registered tools with capability-truth results. | Recoverable work must resume instead of failing falsely. | Accepted |
| DEC-008 | Native image/PDF model input is primary; the visual prepass is dormant fallback only. | Avoid duplicate processing while preserving modality recovery. | Accepted |
| DEC-009 | Local compute is capability-aware and never the default for heavy intelligence. | Mobile, battery, privacy, and memory constraints must be respected. | Accepted |
| DEC-010 | One semantic anchor identity underlies comments, references, citations, context, AI targets, history, and follow mode. | Meaning must survive layout changes. | Accepted |
| DEC-011 | Read-only and Edit are the primary sharing choices. | Internal capability detail stays contextual. | Accepted |
| DEC-012 | Functional gates precede visual, motion, and landing work. | Polish must rest on stable product contracts. | Accepted |
