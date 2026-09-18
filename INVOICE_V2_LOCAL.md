# Invoice v2 local frontend foundation — Stage 9N-A

This is a local foundation, not an invoice editor. Legacy invoices remain at
`/invoices`; no migration or change to their persistence contract is included.

## Enable local mode

Serve this repository on a loopback HTTP origin. Open
`http://127.0.0.1:<port>/invoices-v2.html?emulator=1`.

The explicit `emulator=1` switch stores `businessboss.localEmulators=1` in
sessionStorage for this tab/origin. This keeps existing login redirects and
navigation in local mode. It is accepted only on `127.0.0.1`, `localhost` or
`[::1]` over HTTP(S). Hostname alone never enables local mode. Malformed flags,
unavailable session storage and project mismatches fail closed.

Local mode uses ONE Firebase app with project `demo-businessboss-rules` and
dummy client configuration, with Auth `127.0.0.1:9099`, Firestore
`127.0.0.1:8080`, and Functions `127.0.0.1:5001`, region `africa-south1`.
Connections happen before clients are exported. SDK authentication is automatic.
No production credentials or project data are used by local mode.

The default production configuration is unchanged. Remote origins ignore stored
local mode and reject `emulator=1`. The v2 page refuses initialization without
local mode. To leave local mode explicitly, navigate to
`invoices.html?emulator=0`; this reloads the normal configuration. Do not do this
during emulator-only testing. Local mode applies to all pages in that tab,
including legacy pages; they will use local data. Normal production tabs are
unaffected. Never use real credentials in the demo sign-in form.

Sign in through the existing login page with an emulator-only user. After its
normal dashboard redirect, open Invoices and choose **Invoice v2 · Local**.
That link appears only in local mode. No existing Edit/Create button is replaced.

## Business routing is not authorization

No authenticated business selection was found in the existing app. The isolated
adapter supplies `stage9n-demo-business` only after local Auth has a signed-in
user. It does NOT prove membership, owner role or business activity. The server
checks all of those on every command. No uid-to-business inference is used.

Local fixtures must provision the demo business and membership using the guarded
test infrastructure, never browser code. This is not production tenant selection.
The foundation page creates no business, membership, invoice or customer record.

## Modules and scope

- `js/firebase/config.js`: existing app with Auth, Firestore and Functions.
- `js/firebase/clientEnvironment.js`: explicit environment switch and SDK composition.
- `js/firebase/localBusinessContext.js`: isolated authenticated demo routing.
- `js/features/invoiceDraftApi.js`: testable create/read/update callable adapter.
- `js/features/invoiceDraftClient.js`: binds the adapter to the real browser SDK.
- `js/features/invoiceDraftState.js`: in-memory editor model with copied snapshots.
- `invoices-v2.html` and `js/features/invoiceV2Foundation.js`: local entry shell.

The adapter projects exact root and editable draft/line fields. It adds no token,
identity, owner, role, audit or financial authority. Server validation is unchanged.
There are no browser v2 Firestore reads or writes.

State begins with null revision and accepts revisions only through loaded-server
or successful-update response methods. Quantities and line order are preserved.
Totals are separate; an update invalidates old totals since its response contains
no recalculated totals. State is in memory, not a localStorage cache. Networking,
editing, save coordination and conflict/reload UI belong to Stage 9N-B.

## Verification

`npm run test:frontend` runs pure offline tests with SDK doubles (no production
connections). `npm run test:frontend-smoke` runs the real client SDK plus frontend
modules against the existing guarded local harness. It provisions a synthetic
owner/membership using test-only Admin access, creates and reads a draft through
the adapter and proves revoked membership is still denied. No browser UI workflow
is claimed by this Node client SDK smoke test.

`npm test` includes both foundation tests and the smoke alongside the existing
backend regression suite. Existing Java/emulator prerequisites still apply; the
harness uses only `demo-businessboss-rules` and cleans up owned emulator processes.
No Functions package rebuild, deployment, billing change or production rule change
is required for these frontend changes.
