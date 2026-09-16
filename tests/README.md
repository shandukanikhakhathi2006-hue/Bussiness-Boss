# BusinessBoss local test workflow

Requirements: Node.js 22+, npm, Java 21+ on PATH, and a free local port 8080.

```powershell
npm ci
npm test
```

No Firebase login, global CLI, billing change or Functions workspace is needed. If Java is not on PATH, point this shell at an existing installation (no global changes):

```powershell
$env:BUSINESSBOSS_JAVA_HOME = 'C:\path\to\jdk-21'
npm test
```

The runner prepends that installation's bin directory only for its child process. An existing JAVA_HOME is also supported. On Windows it creates a writable canonical temporary directory and sets jdk.net.unixdomain.tmpdir only for its Java child; other JAVA_TOOL_OPTIONS are preserved. It attempts to remove the empty temporary directory after cleanup. No Java installation or Windows networking settings are modified.

If Java reports `Unable to establish loopback connection` / `Invalid argument: connect` in a restricted Windows temporary directory, set `$env:BUSINESSBOSS_JAVA_TMPDIR` to a short writable workspace directory before running tests. The runner creates a unique socket subdirectory there. This override applies only to the current shell and its children; it does not change system TEMP or networking settings.

## Scripts and results

- `npm run test:finance`: calculations, draft validator and issue validator (330 tests).
- `npm run test:backend`: pure draft authorization contract (127 tests).
- `npm run test:rules`: local Firestore authorization (127 tests).
- `npm run test:persistence`: Stage 9C draft persistence against the emulator (55 tests).
- `npm run test:v2-security`: isolated Stage 9D Invoice v2 client rules fixture (64 tests).
- `npm run test:emulator`: legacy rules, persistence and v2 security files, sequentially in one emulator session.
- `npm test`: finance, backend, then all emulator suites (639 existing tests plus 64 Stage 9D tests; 703 total).

Exit codes determine success; counts are descriptive, not a success heuristic. Dependencies and package-lock remain pinned. The first rules run downloads the emulator if needed; subsequent runs reuse `.firebase/emulators`. An explicit FIREBASE_EMULATORS_PATH cache override is supported.

## Startup and isolation

`runRules.mjs` rejects unsafe environment settings, acquires a project-local run lock and requires 127.0.0.1:8080 to be free. It never reuses an existing emulator or silently changes ports. It launches the supported Firebase CLI `emulators:exec` command with `--only firestore --project demo-businessboss-rules`. Per-run output, debug logs and ownership records live under `.firebase/rules-tests`; CLI configuration is isolated there as well.

The CLI's public command has no Firestore readiness-timeout option. `emulatorStartup.cjs` retains the isolated five-minute allowance through its internal getInfo API and records only this run's emulator PID. It explicitly rejects CLI versions other than 15.29.0 or a missing API. Review this small compatibility hook before any CLI upgrade. Files in node_modules are never patched.

TCP readiness is followed by bounded HTTP readiness: `emulatorEnvironment.mjs` retries local requests for at most 30 seconds, with each request limited to three seconds. A cold emulator listening before HTTP is ready no longer immediately fails all tests. Missing/unexpected FIRESTORE_EMULATOR_HOST and conflicting GCLOUD_PROJECT, GOOGLE_CLOUD_PROJECT or FIREBASE_CONFIG are still rejected before any test initialization. No production Firebase configuration is imported. The endpoint and demo project are fixed; there is no remote fallback.

## Shutdown and occupied ports

Firebase CLI normally shuts down on either child success or failure. The supervisor waits for the CLI's exit event (not inherited-pipe closure), verifies port release, and can clean up only the emulator recorded for its own run. On Windows, fallback cleanup additionally checks that the recorded PID still owns port 8080 before targeting that PID. It never kills arbitrary Java processes or a process found before startup. Signal interruption and a bounded 20-minute overall watchdog enter the same cleanup path. Cleanup failure makes the run fail and prints an actionable message.

A lock prevents concurrent runs. Stale locks are removed only if the recorded runner PID no longer exists; an unverifiable lock is retained for inspection. Port 8080 must be free both before and after each completed run.

Inspect an occupied port in PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 8080 -State Listen | Select-Object LocalAddress, OwningProcess
Get-Process -Id <confirmed-PID> | Select-Object Id, Path, StartTime
```

After confirming it is the leftover test emulator, stop only that PID using `Stop-Process -Id <confirmed-PID> -Force` (use an administrator PowerShell if Windows denies permission). For the pre-hardening leftover verified during Stage 9B.1, the PID was 17972; recheck before using an old PID. A permission boundary cannot be repaired by switching ports or killing unrelated processes.

Verify cleanup after a deliberately failing child:

```powershell
node tests/runRules.mjs --verify-failure-cleanup
```

This deliberately exits nonzero (child exit 23), after emulator cleanup. It is excluded from `npm test`. Check that port 8080 is free afterward. The normal rules command always runs the actual Node suite; no count-based or forced-success shortcut exists.

## Rules baseline

Tests use synthetic user-a, user-b and unauthenticated contexts. The demo state is cleared before every test. Administrative bypass only seeds fixtures; authorization assertions use the client SDK. Current rules cover profiles, customers, bookings, expenses, messages, invoices and payments; direct known-ID attacks, owner queries and protected-field create/update/removal.

Legacy financial amount/status/method and arbitrary unprotected fields remain owner-editable. Owners can delete their financial documents even when provider metadata exists. These tests document current policy; they do not establish verified online payment or an immutable ledger. Neither the rules nor production application code is changed by this harness.

The test harness and its test files are development-only and excluded from Hosting. No Functions, Peach or Resend integration exists. The isolated Stage 9C module is not imported by the production application; no deployment is performed.

## Stage 9C: create-only draft persistence

`js/backend/invoiceDraftPersistence.js` exports the async factory `createEmulatorInvoiceDraftPersistence()`. It returns `{ saveInvoiceDraft, close }`. Call `saveInvoiceDraft({ preparedCommand, invoiceId })` with the unmodified result of `authorizeAndPrepareInvoiceDraftCommand()` and an explicit internal document ID. Always await outstanding saves and call `close()` afterward. The result is `{ invoiceId, path }`.

The factory deliberately depends on the existing test environment and its safety guard for this emulator-only stage. It creates its own fixed demo/localhost client and uses `withSecurityRulesDisabled` to model a future privileged backend. It takes no injected database, credentials, project or endpoint. The environment guard runs at initialization and before each save. This development adapter is not a production server SDK integration or authenticated endpoint. A future production implementation must replace this emulator context and obtain verified identity/business contexts server-side.

Writes target only `businesses/{businessId}/invoices/{invoiceId}`. No parent business document is created. A transaction reads the document, rejects an existing ID with `INVOICE_ALREADY_EXISTS`, and creates the draft atomically. Concurrent creators cannot silently overwrite one another. IDs are internal identifiers, not invoice numbers. A lost success response may leave the caller uncertain whether creation committed; retrying the same ID rejects if it exists. There is no idempotent result-replay or update protocol yet.

The adapter checks required plain-data fields, storage types and path segments, then explicitly copies the normalized customer, dates, line items and domain-calculated totals. It does not authenticate, revalidate currency/dates/quantities, recalculate or check mathematical consistency. A well-shaped forged or modified prepared object is therefore not authenticated by this layer; only trusted code may call it. Raw client fields must pass through Stage 9B/8B first. A fresh snapshot protects an in-flight save from later caller mutation.

Stored defaults are schemaVersion 2, lifecycleStatus draft, paymentStatus not_due, amountPaidMinor 0 and balanceDueMinor equal to the prepared total. Stage 9J adds server-owned revision 1 to this trusted create path: the first persisted version. Customer fields are grouped into a snapshot map using the Stage 9C shape. Stage 9C's explicit lifecycleStatus name and absent invoiceNumber override the broader Stage 7 proposal. Firestore server timestamp transforms populate createdAt and updatedAt. The historical Stage 9C isolated adapter remains unchanged. No issuance, numbering, payment/provider fields, financial events or legacy collection changes are introduced. Old unversioned drafts are not migrated or repaired, including on duplicate create. The create response remains invoiceId plus lifecycleStatus only. Stage 9I compatibility is tested with plain timestamp evidence without persisting an update.

The persistence suite reads resolved timestamps and full documents back from the emulator, checks rejected client injection, malformed contracts, path isolation, sequential/concurrent duplicate creation, immutability, and unchanged legacy records. It also verifies the existing rules deny v2 reads and writes even to the owner; this models administrative persistence, not client access. Both emulator test files clear the demo database and must run with `--test-concurrency=1`, as configured by `--all`. Standalone rules and persistence commands keep the same lock, lifecycle and failure handling.

## Stage 9D: isolated future Invoice v2 client boundary

`firestore.invoiceV2.rules` is a test-only fixture loaded by `invoiceV2SecurityRules.test.mjs`. Production `firestore.rules` and `firebase.json` remain unchanged. The fixture is deliberately not a replacement for the full legacy rule set and must not be deployed.

The fixture uses `businesses/{businessId}/members/{uid}` with `{ uid, role, active }`. Invoice reads require a signed-in user, an existing membership at that user's path, matching membership uid and the boolean `active: true`. Role is informational: owner, staff, accountant and viewer have identical read access, and backend-seeded role case changes do not affect it. Role is not a permission grant. The membership document is the authority; this fixture does not separately require the parent business document to exist. Invoice body ownerId does not grant access to another business path.

Active members may get known invoice documents and query `businesses/{businessId}/invoices`. Cross-business reads require a separate active membership. Collection-group reads across businesses are not granted. All direct invoice create/update/delete operations are denied, including owner writes. Membership and parent business reads/writes are denied in this minimal fixture, so clients cannot enroll themselves, elevate roles or reactivate disabled access. An explicit recursive catch-all denies unspecified paths, including invoice subcollections.

Fixtures are seeded using `withSecurityRulesDisabled`, which models trusted administrative writes. Client rules do not authorize or constrain Admin/server writes; a future backend must perform its own verified identity and tenant authorization. The Stage 9C adapter is unchanged, remains emulator-only, and has not acquired membership-based authorization from this fixture.

The suite uses server reads for revocation checks, ensuring an earlier successful read does not mask lost access through local cache. It tests direct reads, scoped queries, all-role write denial, membership removal/disablement and malformed membership data, self-enrollment/escalation, an atomic enrollment-plus-invoice attack, and unspecified paths. Each emulator suite explicitly loads its own rules. The new suite also restores production rules in its cleanup hook, verifies those rules deny v2 reads even with an active member, clears its synthetic data and closes its environment. Restoration failures fail the run.

All three emulator files must remain sequential under `--test-concurrency=1`: they share the same fixed demo database and change its loaded rules. No second emulator instance, project override, remote fallback or machine-wide configuration is introduced. No production memberships, business documents, backend endpoint or frontend integration exists.

## Stage 9F: local trusted server handler

Run `npm run test:server` for the focused suite. `npm test` includes it after the
three existing emulator suites, sequentially. `--server`, `--all` and
`--verify-failure-cleanup` start Firestore at 127.0.0.1:8080 and Auth at
127.0.0.1:9099 for demo-businessboss-rules. Both ports must be free before and
after the run. Auth lives inside the owned Firebase CLI process. Java cleanup
also checks an owned process that has not yet bound its port, verifying its
parent and command before termination. No unrelated processes are stopped.

The in-process API is:

```javascript
import { createEmulatorSaveInvoiceDraftHandler } from './server/emulatorSaveInvoiceDraftHandler.mjs';
const handler = await createEmulatorSaveInvoiceDraftHandler();
try {
    await handler.saveInvoiceDraft({ idToken, data: {
        businessId: 'business-a', invoiceId: 'draft-1',
        draft: { currency: 'ZAR', lineItems: [] }
    } });
} finally {
    await handler.close();
}
```

Use an Auth Emulator-issued ID token. Admin `verifyIdToken(token, true)` derives
uid and checks user state. Emulator tokens are unsigned; these tests do not
prove production cryptography. The revoked-token test moves the unsigned
emulator token's auth_time back 60 seconds to avoid same-second ambiguity;
success tests use untouched emulator-issued tokens.

Only active owners can save. Business and membership reads, Stage 9B preparation,
Stage 8B calculation, target read and create share a server Firestore transaction.
The internal transaction callback is exported solely for deterministic SDK retry
tests; it is not an authenticated entry point. Never expose that internal API.
Retry tests force ABORTED before commit, change authority, and prove the next
attempt re-reads it. Auth verification is outside the Firestore transaction.

Customer/catalog reference IDs must be omitted or null; non-null normalized IDs
are unsupported and blank strings retain Stage 8B validation errors. Exact
create-only IDs conflict on retries and cannot overwrite. Success returns only
invoiceId and lifecycleStatus. Errors have fixed messages, no stack/cause, and
safe domain codes/known field paths only. Requests are copied before awaits;
getters, proxies, cycles, non-JSON data and payloads over 512 KiB are rejected.

firebase-admin 14.3.0 is an exact development dependency. The local Auth app uses
a synthetic owner credential; the Admin-exported Firestore constructor uses
fixed localhost/demo settings and a nonfunctional placeholder credential. It
never discovers ADC or loads browser config. Credential environment variables,
remote hosts and conflicting projects are rejected before initialization.
No production functions package exists. All new modules are under tests/server,
already excluded by Hosting's tests/** rule. Stage 9B, 9C, finance and both rules
files remain unchanged. No deployment, billing, provisioning or UI integration.

## Stage 9G: Functions package and callable transport

The Node.js 24 / ESM package under functions/ pins firebase-functions 7.3.2 and
firebase-admin 14.3.0. The exported saveInvoiceDraft uses the v2 onCall API in
africa-south1. Nothing is deployed and no billing or secrets are configured.

Bootstrap after root npm ci:

```powershell
npm run build:functions-shared
npm run test:callable
npm test
```

The build command uses ordinary npm pack to distribute the canonical allowlisted
js domain and server modules into an ignored functions/vendor archive, then
installs that archive into functions/ and refreshes its lockfile. It does not
maintain copied source files. Re-run it after changing canonical server/domain
sources. The integration suite compares every installed source byte with its
canonical file to reject stale packaging. functions/ has its own lockfile and
contains everything required to install its runtime dependencies; vendor/ is a
generated packaging artifact, not a second source tree. No tests/** dependency
is packaged. Both functions/** and server/** are excluded from Hosting.

Stage 9F's boundary/repository paths remain compatibility wrappers for canonical
server modules. Its original driver still verifies tokens directly and its 141
tests remain. The one previous no-Functions-package assertion now verifies the
new package and shared server directory are Hosting-excluded.

For callable tests the supervisor starts Auth 127.0.0.1:9099, Firestore
127.0.0.1:8080 and Functions 127.0.0.1:5001 with demo-businessboss-rules.
It sets explicit local-only configuration for discovery and invocation, checks
all three ports before/after, and records owned Functions runtime/discovery
workers through the existing version-checked CLI preload hook. After CLI exit,
surviving workers require verified parent/command identity before Windows cleanup.
A worker cleanup failure still permits independent Firestore cleanup and fails
the run. Unix survivor cleanup fails closed if ownership cannot be verified.

The client sends only { businessId, invoiceId, draft } to httpsCallable. Firebase
Auth attaches the transport token automatically. The pinned SDK publicly exposes
request.auth.rawToken; the handler re-verifies it with Admin verifyIdToken(token,
true), compares its uid with request.auth.uid, and never parses raw headers.
This preserves disabled/deleted/revoked-user checks. Emulator unsigned tokens do
not prove production signature verification. Auth verification and Firestore
commit remain separate services with the same Stage 9F revocation race limitation.

Production-shaped callable options default enforceAppCheck to true. Local tests
explicitly select BUSINESSBOSS_LOCAL_FUNCTIONS=true, which requires the demo
project and fixed emulator endpoints before enforcement can be disabled. Actual
invocations additionally require FUNCTIONS_EMULATOR=true. This stage intentionally
refuses non-emulator persistence; production Admin initialization/deployment needs
a separate review. App Check is not production-enabled by this stage.

Run node tests/runRules.mjs --verify-failure-cleanup to verify all three services
are cleaned up while the deliberate child exit code 23 is preserved. There is
no deployment, tenant provisioning, draft update, issuing, numbering, payment,
email, PDF, or frontend integration in Stage 9G.
`FUNCTIONS_DISCOVERY_TIMEOUT=120` is set only in the local supervisor child environment to accommodate cold module loading; the overall 20-minute run deadline remains.

## Stage 9K — local draft update repository

`tests/server/emulatorInvoiceDraftUpdateRepository.mjs` is an emulator-only server
repository, not a callable. `createEmulatorInvoiceDraftUpdateRepository()` owns a
fixed demo-project Admin client and returns `updateInvoiceDraftTransaction({
businessId, invoiceId, verifiedUid, expectedRevision, input })` plus `close()`.
The caller must already have verified the uid. No application-supplied identity,
external database, credentials or production fallback is accepted. The internal
transaction callback is exported only for controlled SDK retry tests.

Each attempt reads business/member snapshots, preserves the existing disclosure
policy, reuses Stage 9B before target disclosure, and invokes unchanged Stage 9I
against the current invoice. Timestamp instances become immutable plain evidence;
malformed timestamps are not accepted as evidence. Only the approved editable,
calculated, revision and updated-audit fields are written. Creation metadata and
protected lifecycle/payment/identity fields are preserved. Missing targets never
upsert; missing revisions and corrupted records never migrate or repair.

`npm run test:server` now runs both create and update server suites sequentially;
`npm test` includes the update suite too. Tests use real Firestore transactions,
concurrent writers and controlled SDK-aborted retries with changed authority or
invoice state. The callable package, pure domains and create repository are
unchanged, so no shared-package rebuild is needed in Stage 9K. This local module
must be deliberately packaged into a proper server boundary before a future
callable can use it; current Functions never depend on this new test module.

## Stage 9L — local draft update callable

`updateInvoiceDraft` is a second-generation callable with the exact wire envelope
`{ businessId, invoiceId, expectedRevision, input }`. Identity is derived only
from `request.auth.uid`; the platform token is rechecked for disabled, deleted
and revoked users, as in the unchanged create callable. Extra keys are rejected.
The detached request snapshot retains the 512 KiB and depth bounds. Transport
checks shape/types/routes; Stage 9I retains revision and invoice semantics.

The canonical transaction now lives in `server/invoiceDraftUpdateRepository.js`.
The Stage 9K factory is a compatibility wrapper that owns its guarded local Admin
client. Functions composes the same implementation with existing `localServices()`
and an additional Functions runtime guard. Internal service injection is trusted
module composition only; neither public wire data nor the no-argument emulator
factory accepts a database, credentials or project. Mandatory emulator guards,
synchronous immutable snapshots, write masks and per-attempt authorization remain.
No Functions source imports tests. Rebuild the allowlisted shared npm package with
`npm run build:functions-shared` after changing canonical packaged source.

Success returns only `{ invoiceId, revision }` after commit. Errors retain the
application code in `details.code`. Revision conflicts map to callable `aborted`;
they never trigger revision substitution or automatic command replay. Other
mapping conventions match create. The client must resolve a conflict explicitly.

Run `node tests/runRules.mjs --update-callable` for Stage 9L alone, or
`npm run test:callable` for both callable suites sequentially. Full regression
includes all Stage 9K retry/concurrency tests and new actual Auth/Functions
transport tests. The one obsolete Stage 9K assertion that no update export exists
now checks that its export uses a separate server boundary; behavior tests remain.

This is still emulator-only: no UI integration, deployment, production Admin,
rules activation, App Check enforcement change, billing change or Stage 9M.
