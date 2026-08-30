# ManageBac API capture — P13.I1

**Status:** non-live capture complete from the retained manually verified v2p2 manifest. Fresh TGC tenant probing is **not run**: `orchestration/QUESTIONS.md` still requires Pablo's read-only approval, and this worktree has no `cloud-dev` lease. No tenant request was made, no token was read, and no ManageBac write route is present.

## Contract boundary

- Base API: `https://api.managebac.com` after server-side host normalization.
- Authentication: raw token in the `auth-token` request header, loaded only through the existing server `secretStore` path.
- Mode: read-only. Runtime sync selects only capabilities with `permissionState: read_only` and `verificationStatus: verified`.
- Pace: the integration budget is capped at 180 requests/minute (below the provider's documented 200 requests/minute/IP ceiling), with sequential pacing and `Retry-After` handling. Page traversal stops after 500 pages.
- Contract version: `v2p2`. Schema hashes are SHA-256 base64url digests of the retained response-shape contracts.
- Fixtures: [`fixtures/managebac/`](../../../fixtures/managebac/) contains fictional, sanitized contract examples for the seven retained routes. The original live payloads were not retained, so these examples are **not evidence of a fresh 2026-08-30 tenant capture**. `manifest.json` records that boundary mechanically.

## Retained verified read-only routes

| Endpoint                                                                                           | Entity and scope                                                          | Required / mapped response shape                                                                              | Pagination and change notes                                                                                              | Verdict                          |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `GET /v2p2/students?q=<verified email>`                                                            | Signed-in student identity only                                           | `students[]`; required `id`, `email`; maps name, role, program, `year_group_id`                               | No pagination in retained contract. Exact-one email match is enforced server-side.                                       | **VERIFIED (existing manifest)** |
| `GET /v2p2/memberships?user_ids={student_id}`                                                      | Memberships for the resolved student                                      | `memberships[]`; required `id`, `user_id`, `class_id`; maps class label, role, level                          | Page parameter `page`; next page from `meta.next_page`; full reconciliation                                              | **VERIFIED (existing manifest)** |
| `GET /v2p2/classes/{class_id}`                                                                     | Details for membership-discovered classes only                            | `class` object; required `id`; maps class name, description, programme, level, grade/year group               | Fan-out only over class IDs from the personal membership result; full reconciliation                                     | **VERIFIED (existing manifest)** |
| `GET /v2p2/classes/{class_id}/tasks`                                                               | Assignments for membership-discovered classes                             | `tasks[]` (fallbacks `coursework[]`, `items[]`); required `id`; maps title, description, due/start, task type | Page parameter `page`; `meta.next_page`; full reconciliation                                                             | **VERIFIED (existing manifest)** |
| `GET /v2p2/classes/{class_id}/timetable`                                                           | Timetable slots for membership-discovered classes                         | `timetable.academic_years[].slots[]`; numeric weekday 1–7 and period; exact timestamps only when supplied     | No pagination. Missing clock time remains `timePrecision: unknown`; no invented time                                     | **VERIFIED (existing manifest)** |
| `GET /v2p2/classes/{class_id}/resources`                                                           | Resources for membership-discovered classes                               | `resources[]` (fallbacks `files[]`, `items[]`, `documents[]`); required `id`; maps title, description, URL    | Page parameter `page`; `meta.next_page`; full reconciliation                                                             | **VERIFIED (existing manifest)** |
| `GET /v2p2/year-groups/{year_group_id}/projects/cas/experiences/students?student_ids={student_id}` | CAS experiences for the resolved student and their embedded year-group ID | `students[].experiences[]`; required experience `id`; maps status, dates, strands, hours                      | Page parameter `page`; `meta.next_page`; full reconciliation. Year-group fan-out comes from the verified student record. | **VERIFIED (existing manifest)** |

The retained manifest exposes year-group identity through `students.year_group_id` (and class details where supplied). It does **not** contain a separately verified year-group listing endpoint.

## Unverified frontier

These product data categories have no captured tenant-approved path, permission result, or sampled response contract. `unverifiedPersonalCapabilityFrontier()` records them with `providerPath: null`; they are not inserted into the readable route manifest and cannot be called. Until the approved live probe says otherwise, the product must treat them as unavailable.

| Requested data                         | Path         | Permission / shape                      | Current verdict                      |
| -------------------------------------- | ------------ | --------------------------------------- | ------------------------------------ |
| CAS reflections                        | Not captured | Unknown                                 | **UNVERIFIED — live probe required** |
| CAS evidence / attachments             | Not captured | Unknown                                 | **UNVERIFIED — live probe required** |
| Grades / assessment results            | Not captured | Unknown                                 | **UNVERIFIED — live probe required** |
| Term grades                            | Not captured | Unknown                                 | **UNVERIFIED — live probe required** |
| Attendance                             | Not captured | Unknown                                 | **UNVERIFIED — live probe required** |
| Groups / group memberships             | Not captured | Unknown                                 | **UNVERIFIED — live probe required** |
| Discussions / announcements / messages | Not captured | Unknown                                 | **UNVERIFIED — live probe required** |
| Events                                 | Not captured | Unknown                                 | **UNVERIFIED — live probe required** |
| Standalone year-group listing/details  | Not captured | Unknown; only embedded IDs are retained | **UNVERIFIED — live probe required** |

## Approved live-probe procedure (not executed here)

1. Acquire Pablo's recorded approval and the exclusive `cloud-dev` lease.
2. Load the token through `secretStore`; never expose it to the browser, logs, fixtures, or command output.
3. Use only `GET` and the `auth-token` header. Pace within the configured 180/minute ceiling and honor `Retry-After`.
4. Probe the seven retained routes first, then only tenant-reference frontier paths. Record status, permission, response envelope, pagination, and null/omission behavior.
5. Sanitize payloads before they enter `fixtures/managebac/`: replace all identities, emails, URLs, tenant names, IDs, and free text; retain types, nesting, optionality, and pagination envelopes.
6. Promote a frontier item into `officialPersonalCapabilities()` only when path, read permission, audience, pagination, and response schema are all evidenced. Record denied/absent routes as unavailable; never guess a route from the old client.

## P13 handoff

P13.I2–I4 may test the seven retained contracts entirely from fixtures. They must not claim reflections, evidence, grades, attendance, groups, discussions/messages, events, or standalone year-group reads. P13.V1 owns the live-tenant proof after P9 supplies the isolated local instance and Pablo enters the key.
