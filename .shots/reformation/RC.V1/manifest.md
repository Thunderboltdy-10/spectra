# RC.V1 real-corpus evidence — 2026-08-30

Status: **REJECTED**. RC-1's class-wide DOCX projection defect is repaired, but the existing P5 realtime proxy defect prevents a Spectra edit from reaching Yjs, surviving reload, or entering native materialization. A clean full-corpus sequence therefore cannot pass.

## Corpus and sequence

- Only copies under `Downloads\spectra-rc-corpus` were mounted. The OneDrive originals were not mounted, edited, or changed.
- `00-workspace-baseline.png`–`08-library-corpus-list.png`: clean workspace, Bridge startup, folder selection, and all three copied corpus items visible in Library.
- `09-ee-open-initial.png`–`11-ee-equations-missing.png`: red RC-1 baseline. The real Extended Essay opened with equations absent and its rich table content flattened.
- `12-word-ee-first-page.png`–`24-word-ee-before-close.png`: Word reference walk for the same copy, including cover image, equation-dense pages, and equation-bearing tables.
- `25-ee-after-word-close-syncing.png`: Spectra after closing the native Word comparison.
- `26-ee-rich-cover.png`–`29-ee-display-equations.png`: repaired signed-in render and edit-safety pass.
- `30-bridge-connected-proxy-blocked.png`: Bridge reports Connected while the realtime proxy remains disconnected.

The systemic blocker stopped the sequence before the presentation and spreadsheet option/round-trip walks. Those surfaces are not claimed.

## RC-1 repair evidence

- The real EE renders **7 tables / 40 rows / 122 cells** and **695 KaTeX equations**, including **433 display equations**. Strict KaTeX rendering accepted **695/695** projected expressions.
- `26-ee-rich-cover.png`: the native cover image renders at **1106 × 830** from a bounded authenticated package-part reference; no base64 package copy is stored in collaborative content.
- Authenticated media fetch: **200**, `image/png`, **1,186,444 bytes**. The same route without authentication returned **401**.
- `28-ee-equation-table.png`: native table topology and OMML inside cells render in place. `29-ee-display-equations.png`: display and mixed prose/equation ordering render rather than flattening or disappearing.
- `27-ee-safe-edit-protected-rich.png`: a native equation paragraph is non-editable; Playwright `fill()` was rejected and its content remained unchanged. A safe prose paragraph accepted marker `RCV1-SPECTRA-30`.
- The repair is class-wide: ordered DOCX rich inline content, OMML→LaTeX, display equations, rich table cells, native image references, read-only native boundaries, and matching TipTap/Yjs projections share one contract.

## Rejecting blocker

- A direct WebSocket upgrade to the collaboration gateway on port `1234` returned **101**.
- `localhost:3000/_spectra/realtime?foo=1` returned **400**. `scripts/next-dev-server.mjs` forwards a query-only upgrade target as `?foo=1`; the upstream requires `/?foo=1`.
- The browser emitted repeated WebSocket warnings. There were no console errors, but no realtime connection was established.
- Bridge remained Connected, yet its SQLite queue stayed empty and no new `file.write` was observed. The marker therefore remained browser-local and could not be used as persistence or Word read-back evidence.
- The exploratory proxy patch and test edit were reverted completely. RC.V1 does not modify `scripts/next-dev-server.mjs` or `collaboration-gateway.test.ts`.

## Automated gates

- Focused Vitest: `docx-lens.test.ts` + `document-native-projection.test.ts` — **2 files / 38 tests passed**.
- Broader seam suite — **87/87 passed** during the repaired live pass.
- Scoped ESLint — **0 errors**; 167 pre-existing warnings in the two large studio shells.
- Capability IR ghost gate passed. Secret scan passed across **2,237 tracked files**.
- Root `tsc --noEmit` remains red only on recorded unrelated files; no actual RC.V1 patch file is named.
- `npx convex dev --once --typecheck=enable` passed: **Convex functions ready**.
- `git diff --check` and the final scoped index audit pass before commit.

## Paste-ready P5.I2 continuation

> Repair the P5 realtime proxy without changing RC.V1's fidelity patch. In `scripts/next-dev-server.mjs`, normalize query-only WebSocket upgrade targets from `?…` to `/?…` while preserving ordinary paths and queries. Add focused regression coverage. Prove both a direct gateway upgrade on port 1234 and the proxied `/_spectra/realtime?...` path return HTTP 101. Then, in a signed-in fresh browser context, prove a document edit reaches Yjs, survives reload, emits no repeated WebSocket warnings, and reaches native materialization/Bridge `file.write`. Do not weaken handshake, auth, or Convex gates. Run focused Vitest, scoped ESLint, capability/secret/diff checks, and `npx convex dev --once --typecheck=enable`; return numbered evidence and one scoped commit.
