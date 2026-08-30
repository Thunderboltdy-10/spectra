# QUESTIONS — the only channel to Pablo

Items only the R18 carve-outs justify: secrets/keys, production deploys, destructive actions on real user files, gate-weakening arbitration, a class twice-failed at max, the §9 sign-in, the P8.V2 signature. Everything else the orchestrator answers itself from the docs stack. A queued question never blocks other tracks.

Format: `- [ ] YYYY-MM-DD · <who is blocked> · <question> · <what proceeds meanwhile>`

---

- [x] 2026-08-30 · P5.V1 / P8.V1 · Account-B headed sign-in completed; storage state saved by the active setup holder, all later use headless and collaboration-only. · Account A remains the default; local Yjs gateway only until Pablo deploys production.
- [ ] 2026-08-30 · P11.I1/I2 · Create a Google Cloud OAuth app (scopes: Drive read/write, Calendar read/write) and hand client id/secret into `.env.local` per LOCAL-DEPLOY.md. · Both units build and test against recorded fixtures; live probes are their last leg.
- [ ] 2026-08-30 · P11.I3 · Create an Azure app registration (Microsoft Graph `Calendars.ReadWrite`, delegated) and hand credentials over. · Unit proceeds on recorded fixtures.
- [ ] 2026-08-30 · P11.I4 · Create a Notion integration (or OAuth app) and hand the token over. · Unit proceeds on recorded fixtures.
- [ ] 2026-08-30 · P9.I4 / P9.V1 · Confirm the secondary-account email for `SUPER_ADMIN_EMAILS` on the local instance (the account without compatible ManageBac classes becomes platform operator; account A becomes TGC school_admin), then run the LOCAL-BOOTSTRAP.md checklist: both sign-ins, accept the TGC invitation, enter the ManageBac API key at `/managebac`, re-pair Bridge to the local instance, re-import the local folders. · P9.I1–I3 proceed regardless; P9.V1's two-account journey waits only on this checklist.
- [ ] 2026-08-30 · P13.I1 · Approve read-only live probing of the TGC ManageBac tenant within the configured rate budget (token via the existing secretStore path; fixtures sanitized before commit). · Probing of already-verified routes proceeds from the existing manifest; the unverified frontier waits for this ack.
