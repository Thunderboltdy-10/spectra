# F-01 Sharing and permission lifecycle

Date: 2026-07-26. Status: in progress.

## Verified environment repair

The two campaign accounts were initially in different schools, so the documented
two-user collaboration topology did not exist:

- P (`[school-account-email]`) was in The Global College.
- C (`pablo.martinez.dovale@gmail.com`) was in Spectra Demo Workspace.

Using the audited admin/operator flows, the obsolete C membership in Spectra
Demo Workspace was ended after promoting another member to preserve last-admin
continuity. The operator session was then ended. C was invited to and joined The
Global College as a student. Both campaign accounts are now in the same school.

No invitation token or secret is retained in campaign evidence.

## Direct share verified

P invited C to `Enzyme Inhibitors — Study Notes` with modify access. C accepted
from Artifacts → Invitations and opened the artifact. C saw “Shared directly
with you · You can modify this artifact” and a live editor.

P's already-open editor temporarily showed `Access removed` and the sharing
dialog retained `Invitation pending`. Closing and reopening the artifact
recovered P to `Live · 1 here` without a data or authority error. This stale
open-session recovery is recorded as a UX defect; the underlying grant was
correct.

Remaining F-01 matrix: private direct-URL denial, read-only, live upgrade,
workspace inheritance/exception, public/un-public, and live revoke.

