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
- `npm test`: all three groups in order (584 current tests).

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

All tooling is development-only and excluded from Hosting. No Invoice v2 persistence, Functions, Peach or Resend integration exists.
