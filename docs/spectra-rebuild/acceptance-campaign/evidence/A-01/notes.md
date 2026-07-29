# A-01 Process and health verification

Date: 2026-07-24

## Checks
- `http://localhost:3000/api/health` → `{"service":"spectra-web","status":"ready","protocolVersion":1}`
- `http://localhost:1234/_spectra/health` → `{"service":"spectra-collaboration-gateway","protocolVersion":1,"status":"ready"}`
- Ports: 3000 Listen (PID 41380), 1234 Listen (PID 68152)
- concurrently process running: web, collab, ai-worker, mb-worker
- `scripts/spectra-ai-worker.mjs` PID 3404
- `scripts/managebac-sync-worker.mjs` PID 32064
- `scripts/collaboration-gateway.mjs` PID 68152
- Next dev PID 64284 / start-server 41380

## Grade
**Excellent** — all four processes alive; both health endpoints ready.

## Notes
Clerk development-key warnings expected; not graded as defects.
