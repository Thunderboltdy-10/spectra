# LOCAL-BOOTSTRAP — seed and finish a fresh local school

The local bootstrap turns an empty instance into the smallest honest Spectra school:
account B is the membershipless platform operator, account A becomes The Global
College's `school_admin`, ManageBac is connected, and an explicitly sacrificial
folder is imported through the Bridge. This runbook never targets cloud Convex.

## Preconditions and safety boundary

- Start from an instance created with `LOCAL-DEPLOY.md`; its Convex URL must be
  loopback and its deployment selector must begin with `local:`.
- Install dependencies with `npm ci` before running the seed.
- Put account B's email in that instance's `SUPER_ADMIN_EMAILS`. If the list has
  more than one address, the seed requires `--operator-email`.
- Use separate saved browser profiles: **A** for the future TGC school admin and
  **B** for the platform operator. Sign both into the same local app origin.
- Bind the web server to `localhost`, and browse `http://localhost:<web-port>`.
  Clerk redirects to the configured localhost origin; binding only to
  `127.0.0.1` can turn the redirect into a failing self-proxy.
- Never mount, rename, move, edit, or delete
  `<local-workspace>`. For this dry run, the only
  authorized source is `<local-workspace> - Copy`.

The seed reads instance-owned values from
`.spectra-local/instances/<n>/env.local`, verifies the matching local port and
`local:` deployment, and refuses a cloud or mismatched target before mutation.

## 1. Start and sign in

Start the isolated stack in one terminal:

```powershell
npm run dev:local -- --instance 1
```

If bringing up the web process separately, keep the hostname explicit:

```powershell
$env:SPECTRA_WEB_HOST = "localhost"
npm run dev:web
```

Open the printed localhost URL in saved profile B and complete sign-in. Do the
same in saved profile A. This creates both local account projections without
creating a school membership for B. Expected result: both profiles reach a
signed-in Spectra shell; B's normalized email exactly matches an address in the
instance's `SUPER_ADMIN_EMAILS`.

## 2. Run the deterministic seed

Use the two signed-in account emails; do not put them in committed files:

```powershell
node scripts/local/seed.mjs --instance 1 --operator-email "<ACCOUNT_B_EMAIL>" --admin-email "<ACCOUNT_A_EMAIL>"
```

The script derives a stable idempotency key and invitation token from the local
instance, TGC slug, account A, and the instance encryption key. It calls the
real `schools:create` mutation, which creates the school, onboarding saga, and
initial `school_admin` invitation. It does not insert any of those tables
directly. Re-running the same command is safe and resolves the same saga.

Expected terminal result before acceptance:

```text
School: The Global College
Saga: invited
Account A established: not yet — accept the saved invitation
```

The private join URL and summary are written under the instance directory:

```text
.spectra-local/instances/1/bootstrap-admin-invitation.txt
.spectra-local/instances/1/bootstrap-summary.json
```

They are runtime artifacts and must not be committed or pasted into logs.

## 3. Accept account A's invitation and verify

In saved profile A, open the URL from
`bootstrap-admin-invitation.txt`. The expected screen is `/join` naming The
Global College and the `school_admin` role. Accept the invitation and continue
to the school product.

Then run the read-only projection check:

```powershell
node scripts/local/seed.mjs --instance 1 --operator-email "<ACCOUNT_B_EMAIL>" --admin-email "<ACCOUNT_A_EMAIL>" --verify-only
```

Expected result:

```text
School: The Global College
Saga: ready
Account A established: yes
```

The verified membership must be `active` with role `school_admin`. `--verify-only`
does not call `schools:create` and does not regenerate the invitation.

## 4. Check both authorization paths

In profile A, open `/admin`. Expected screen: **School administration** for The
Global College, with ordinary member-management and integration surfaces.

In profile B, open `/superadmin`. Expected screen: **Platform administration**
showing one active school. Open **Schools**, choose **Enter school**, provide an
audit reason, and start an **Inspect (read-only)** session. Expected result:
`/admin?operatorSessionId=...` with a persistent banner naming The Global
College, the access mode, expiry, and **End session**. End the session after the
check. B must not gain a school membership from this flow.

## 5. Connect and bootstrap ManageBac

In profile A, open `/managebac`:

1. Select **Connect ManageBac**. The canonical provider endpoint is read-only.
2. Enter the school-wide read-only API key, or use the temporary server test
   key only when the screen says one is available. Select **Connect**.
3. Import the reviewed tenant capability manifest if the connection does not
   already contain it. Never invent routes or broaden a capability to make the
   status green.
4. Select **Resolve my school identity**. Spectra must match the authenticated
   school email to exactly one provider identity; there is no selectable list
   of other accounts.
5. Select **Sync now** and wait for the personal bootstrap run to finish. Check
   **Sync history** and **Review capabilities**.

Expected truth is evidence-based, not necessarily green. All usable personal
capabilities must be read-only and verified. If some source records cannot be
projected, the integration must report **degraded** / partial coverage and keep
those rows quarantined rather than claiming a complete sync. The 2026-08-31
local dry run discovered seven official personal capabilities, verified all
seven readable, failed none, and truthfully retained four quarantined projection
records; that is an acceptable baseline, not a reason to relabel the connection.

After identity/bootstrap, P8.V1's first-run flow must show the authenticated
person's class candidates and ask which current classes should appear. It never
auto-selects every historical provider class. Search, keyboard selection, Skip,
double-submit idempotency, and hard-reload resume are required. The same choice
must remain available from School or ManageBac; removing an auto-created class
shelf moves its work to General rather than deleting it.

## 6. Pair the Bridge and import only the copy

Run a Bridge built from the same checkout as the local Convex functions. Point
it at the exact instance and isolate its journal:

```powershell
$env:SPECTRA_CONVEX_URL = "http://127.0.0.1:3002"
$env:SPECTRA_ORIGINS = "http://localhost:3000"
$env:SPECTRA_BRIDGE_DATA_DIR = (Resolve-Path ".spectra-local/instances/1").Path + "\bridge"
cargo run --release --manifest-path bridge/Cargo.toml -p spectra-bridge
```

Adjust the two ports for another instance. In profile A, open **Settings → Files
and devices**, pair the connected Bridge, choose **Add folder**, and select only:

```text
<local-workspace> - Copy
```

The folder picker must show that exact final component before selecting it.
Expected progression is a connected device, then a mounted card with measured
file progress, then **Available in Spectra**. A plain retry state with processed
and total counts is also truthful; use **Retry** only after fixing the displayed
cause. If the Bridge reports a missing `bridgeSync` function, rebuild it from
the current checkout before retrying—the executable and local Convex bundle are
protocol peers. Never work around an error by pointing the Bridge at cloud
Convex or by mounting the original `IBDP1` folder.

## 7. Close without deleting the onboarding state

- End any operator school session.
- Close saved browser sessions A and B.
- Stop the Bridge, web server, collaboration gateway, and local Convex process.
- Preserve `.spectra-local/instances/1/`, including its Convex data, Bridge
  journal, private invitation, and bootstrap summary. Do not run `local:reset`.
- A later P8.V1 verifier may restart the same instance and inspect the sequence.
  Use `final-verification/scripts/fresh-instance.mjs` to allocate another empty
  database for a clean first-person replay; never reset this evidence instance.
