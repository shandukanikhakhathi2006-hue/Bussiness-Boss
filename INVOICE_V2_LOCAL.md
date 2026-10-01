# Invoice v2 local draft editor — Stage 9N-B

This is an emulator-only draft editor. Legacy invoices remain at `/invoices`;
no migration or change to their persistence contract is included.

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
The editor creates and updates drafts only through the existing callables. It
creates no business, membership or customer record.

## Modules and scope

- `js/firebase/config.js`: existing app with Auth, Firestore and Functions.
- `js/firebase/clientEnvironment.js`: explicit environment switch and SDK composition.
- `js/firebase/localBusinessContext.js`: isolated authenticated demo routing.
- `js/features/invoiceDraftApi.js`: testable create/read/update callable adapter.
- `js/features/invoiceDraftClient.js`: binds the adapter to the real browser SDK.
- `js/features/invoiceDraftState.js`: in-memory editor model with copied snapshots.
- `invoices-v2.html` and `js/features/invoiceV2Foundation.js`: local editor entry.
- `js/features/invoiceDraftWorkflow.js`: command coordination and safe error states.
- `js/features/invoiceDraftForm.js`: exact decimal conversions and form projection.
- `js/features/invoiceDraftEditor.js` and `invoice-v2.css`: controlled accessible UI.

The adapter projects exact root and editable draft/line fields. It adds no token,
identity, owner, role, audit or financial authority. Server validation is unchanged.
There are no browser v2 Firestore reads or writes.

State begins with null revision and accepts revisions only through loaded-server
or successful-update response methods. Quantities and line order are preserved.
Totals are separate. After create, the editor reads and adopts the server draft
without inventing revision 1. After update, it adopts the returned committed
revision, then reads back and requires that exact revision before replacing
content/totals. A mismatched or failed readback requires deliberate reload.
State is in memory, not a localStorage cache.

## Use the editor

Choose **New Invoice v2 Draft**, enter customer details, optional calendar dates
and line items, then **Create draft**. IDs use `crypto.randomUUID()`, never invoice
numbers. Lines can be added/removed and retain stable IDs and string quantities.
Currency is fixed ZAR; customer/catalog references remain null. Amounts use plain
decimal strings such as `1250.00` (no commas or currency symbol). Tax percentage
uses at most two decimal places: `15.00` becomes 1500 basis points. Conversion uses
integer arithmetic; full domain validation remains server-owned.

Load by the ID input or `invoices-v2.html?emulator=1&id=<invoiceId>`. The route is
only a reference; the server checks access. Save always sends a complete editable
draft and the current loaded revision, never totals or authority fields.

During requests, editing and competing actions are disabled. A conflict preserves
your unsaved input and revision without retries. **Reload latest version** asks
before replacing edits. A lost write response, failed post-save read or changed
readback revision blocks further saves until reload; no result is fabricated.
The server totals are shown after load/save. Edited inputs show a local preview
using the existing calculation engine, never submitted as financial authority.

## Optional browser verification fixture

With the existing Java/emulator prerequisites configured, run
`node tests/runRules.mjs --frontend-browser`. This guarded demo-only fixture seeds
one synthetic owner/business/membership and serves the checkout on
`127.0.0.1:4173` for at most 60 minutes. Open
`http://127.0.0.1:4173/invoices-v2.html?emulator=1`, sign in through the existing
login page with `stage9nb-browser@example.test` / `local-browser-test`, then return
to the v2 page in the same tab. These are disposable emulator credentials.

Test-only control files under ignored `.firebase/` let the verification operator
simulate another writer through the real callables or inspect the result. Write
`{"action":"other-writer","invoiceId":"<draft-id>"}` to
`.firebase/invoice-browser-command.json`; observe `.firebase/invoice-browser-status.json`.
Use `{"action":"inspect","invoiceId":"<draft-id>"}` for a readback and
`{"action":"stop"}` for orderly shutdown. The browser cannot access these files
or the test scripts through the static server. They are never production endpoints.

## Verification

`npm run test:frontend` runs pure offline tests with SDK doubles (no production
connections). `npm run test:frontend-smoke` runs the real client SDK plus frontend
modules against the existing guarded local harness. It provisions a synthetic
owner/membership using test-only Admin access, creates and reads a draft through
the adapter and proves revoked membership is still denied. No browser UI workflow
is claimed by this Node client SDK smoke test.

The workflow unit suite additionally tests money/tax conversion, readback failure,
duplicate actions, safe error mapping, conflict preservation and explicit reload.
The real emulator workflow proves create/read at revision 1, updates to 2 and 3,
another writer at 4, stale conflict, deliberate reload and a final save at 5.

`npm test` includes foundation/workflow tests and both smokes alongside the existing
backend regression suite. Existing Java/emulator prerequisites still apply; the
harness uses only `demo-businessboss-rules` and cleans up owned emulator processes.
No Functions package rebuild, deployment, billing change or production rule change
is required for these frontend changes.

### Browser readiness and timing

Browser mode uses a 25-minute bounded startup phase on slow local machines.
The synthetic fixture signs in and obtains INVALID_REQUEST from authenticated
empty-envelope probes of saveInvoiceDraft, getInvoiceDraft and updateInvoiceDraft.
These probes create no invoice. Only after those responses and static-server
startup does a run-token-scoped readiness marker start the separate 15-minute
browser session (16-minute parent watchdog includes cleanup grace).
Ordinary test runs retain their existing 20-minute budget. The ownership tracker
also records the browser helper so interrupted runs can clean up only that run.
The inspect command checks persisted revision/totals and absence of a legacy write.
Browser mode additionally allows up to 300 seconds for Functions discovery,
following an observed 120-second discovery timeout. Normal runs retain 120 seconds.
The overall browser startup cap remains 25 minutes; readiness is still mandatory.
