# Launch runbook

How Spectra goes from the local stack to the cloud. Every step here is one Pablo starts; nothing in the repository
deploys on its own. Order matters: each tier needs the addresses and keys of the one before it.

## What runs where

| Tier | Host | What it is |
| --- | --- | --- |
| Backend | Convex (cloud, production deployment) | Database, functions, scheduled runs, file storage, vector and text search |
| Web app | Vercel | Next.js: pages, the AI run route, the Clerk webhook (`/api/webhooks/clerk`) |
| Collaboration | Fly.io, one machine (`deploy/collaboration-gateway/fly.toml`) | The live editing gateway (Y.js rooms in memory) |
| Bridge | The user's computer | Tauri app, built by the manual workflow `.github/workflows/bridge-desktop.yml` |
| Auth | Clerk (production instance) | Sign-in; Convex trusts its JWT issuer |
| Models | OpenRouter | Every Spectra turn and the embeddings |

## Before you start

- A Convex production deployment, a Vercel project, a Fly app (`spectra-collaboration-gateway`), a Clerk production
  instance with your domain, an OpenRouter key with credit, and SMTP for invitation emails.
- Fresh random secrets of 32 or more characters, one per name, never reused between names:
  `SPECTRA_MASTER_ENCRYPTION_KEY`, `SPECTRA_SECRET_BRIDGE_KEY`, `SPECTRA_COLLAB_BRIDGE_KEY`,
  `SPECTRA_COLLAB_TOKEN_SECRET`, `SPECTRA_CONNECTOR_BRIDGE_KEY`, and optionally `SPECTRA_AGENT_EVAL_BRIDGE_KEY`,
  `SPECTRA_MANAGEBAC_WORKER_HTTP_KEY`. Keep them in a password manager. Never commit them.

## 1. Convex

1. Deploy the functions: `npx convex deploy` (production). This also checks the schema; the schema never reads the
   environment (`convex/schema-imports.test.ts`).
2. Set the environment on the deployment (`npx convex env set NAME value --prod`):
   - **Required:** `CLERK_JWT_ISSUER_DOMAIN`, `SPECTRA_APP_URL` (the https web origin), `SUPER_ADMIN_EMAILS`,
     `OPENROUTER_API_KEY`, `SPECTRA_SECRET_BRIDGE_KEY`, `SPECTRA_COLLAB_BRIDGE_KEY`, `SPECTRA_CONNECTOR_BRIDGE_KEY`
     (the three keys identical to Vercel's).
   - **Search:** `SPECTRA_EMBEDDING_MODEL` (an OpenRouter embedding model returning 256 dimensions) and optionally
     `SPECTRA_EMBEDDING_PROVIDER`. Unset, search runs on exact words only and says so.
   - **Optional:** `SPECTRA_AGENT_EVAL_BRIDGE_KEY`, `ARTIFICIAL_ANALYSIS_API_KEY`.
   - **Must be absent:** `SPECTRA_LOCAL_SELF_HOSTED`, `SPECTRA_ALLOW_LOCAL_MANAGEBAC_FIXTURE`, and every
     `SPECTRA_*_EVIDENCE` flag.
3. Fill the search index once embeddings are set: `npx convex run semanticIndex:startBackfill --prod` and
   `npx convex run memory:backfillEmbeddings '{"limit":200}' --prod` (repeat until it reports nothing left).
4. Complete the catalog summaries: `npx convex run spectraArtifacts:backfillSummaries '{"cursor":null,"limit":10}' --prod`,
   then pass each returned cursor until it reports `done` (agent and artifact catalogs need the whole traversal).
5. Start school usage ceilings from real totals: `npx convex run metering:backfillSchoolUsageTotals '{}' --prod`, once.
6. Run `npx convex codegen` and confirm `convex/_generated/api.d.ts` has no diff.

## 2. Collaboration gateway (Fly)

1. Secrets: `fly secrets set CONVEX_URL=<convex url> SPECTRA_COLLAB_TOKEN_SECRET=… SPECTRA_COLLAB_BRIDGE_KEY=…`.
2. From the repository root:
   `fly deploy . -c deploy/collaboration-gateway/fly.toml --dockerfile deploy/collaboration-gateway/Dockerfile --ha=false`.
3. Keep exactly one machine (`fly scale count 1`); scale the VM up, never out. Its `wss://` address is
   `NEXT_PUBLIC_SPECTRA_COLLAB_URL` below.

## 3. Web app (Vercel)

1. Environment (Production), from `.env.example`:
   - Convex: `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`.
   - Origins: `NEXT_PUBLIC_APP_URL`, `SPECTRA_APP_URL`, `SPECTRA_APP_ORIGIN` (all the https domain).
   - Clerk: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (production `pk_live`/`sk_live`),
     `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SECRET`.
   - Secrets: the keys listed under "Before you start", plus `NEXT_PUBLIC_SPECTRA_COLLAB_URL`.
   - Models: `OPENROUTER_API_KEY`, `SPECTRA_MODEL_ID`, `SPECTRA_REASONING_PROFILE`, `SPECTRA_MODEL_PROVIDER`, and the
     optional fallback and judge settings. `OPENROUTER_APP_NAME`, `OPENROUTER_SITE_URL`.
   - Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`. `SUPER_ADMIN_EMAILS`, `LOG_LEVEL`.
   - **Must be absent:** `MANAGEBAC_API_KEY` and every development-only name in `scripts/check-deploy-env.mjs`.
2. Deploy. `prebuild` runs `check:deploy-env`, which fails a production build on a missing model setting, a localhost
   URL, a development Clerk key or a short secret.
3. In Clerk, add the webhook `https://<domain>/api/webhooks/clerk` and copy its signing secret into
   `CLERK_WEBHOOK_SECRET`.
4. Check the run route's duration limit against the Vercel plan (P2-OPS-PERFORMANCE, "Run route duration").

## 4. Bridge

1. Run the workflow **Spectra Bridge desktop artifacts** by hand with `convex_url` (the production Convex URL) and
   `allowed_origins` (the web origin). `friend-test` gives unsigned Windows and macOS builds.
2. Test on Windows and on the friend's Mac: install, pair from Devices, sync a folder, open in Office, update.
3. For a public release, run `public-candidate` with the signing secrets configured, then decide where updates are
   hosted. Nothing is published automatically.

## 5. First hour

Sign in as the super admin, create the school, invite a teacher and a student, connect ManageBac with the school's own
key, and make one of each work. Then run the live verification prompts in
`docs/spectra-launch-audit/LIVE-VERIFICATION-PROMPTS.md` journey by journey, fixing as you go.

## Not in this launch

- The Bridge cloud relay (controlling a Bridge on another computer): designed in
  `docs/spectra-launch-audit/reports/R-L4-LEFTOVERS.md`, deferred by decision.
- A collaboration gateway with more than one machine.
