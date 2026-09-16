import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { assertFunctionsEmulatorEnvironment } from './emulatorEnvironment.mjs';
import { assertEmulatorEnvironment, assertServerEmulatorEnvironment, demoProjectId, emulatorHost } from './emulatorEnvironment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(root, '.firebase', 'rules-tests');
const lockPath = path.join(work, 'run.lock');
const token = randomUUID();
let locked = false;
let child;
let statePath;
let workersPath;
let javaTemp;
let interrupted = false;
let watchdog;
let output;
let ports = [8080];

async function portFree(port = 8080) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
        server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolve(true)));
    });
}
async function waitForFreePort(milliseconds, port = 8080) {
    const deadline = Date.now() + milliseconds;
    do {
        if (await portFree(port)) return true;
        await delay(250);
    } while (Date.now() < deadline);
    return false;
}
function takeLock() {
    fs.mkdirSync(work, { recursive: true });
    if (fs.existsSync(lockPath)) {
        const previous = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        try { process.kill(previous.pid, 0); }
        catch (error) {
            if (error.code !== 'ESRCH') throw new Error(`Cannot verify the existing test lock: ${lockPath}`, { cause: error });
            fs.unlinkSync(lockPath);
        }
    }
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
    fs.closeSync(fd);
    locked = true;
}
function stopOwnedEmulator() {
    if (!statePath || !fs.existsSync(statePath)) return;
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (state.token !== token || state.cliPid !== child?.pid || !Number.isInteger(state.pid) || state.pid <= 0) {
        throw new Error('Invalid emulator ownership record; no process was terminated.');
    }
    try { process.kill(state.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return; throw error; }
    if (process.platform === 'win32') {
        // Confirm this run's recorded Java PID still owns the fixed port.
        const listing = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
        const ownsPort = listing.status === 0 && listing.stdout.split(/\r?\n/).some(line => {
            const fields = line.trim().split(/\s+/);
            return fields[0] === 'TCP' && fields[1] === emulatorHost && fields[2] === '0.0.0.0:0' && Number(fields.at(-1)) === state.pid;
        });
        if (!ownsPort) {
            // Java may still be starting and have no listening socket. Verify
            // its parent and command before stopping the recorded process.
            const query = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
                `$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter 'ProcessId=${state.pid}' | Select-Object ParentProcessId,CommandLine | ConvertTo-Json -Compress`],
                { encoding: 'utf8', windowsHide: true, timeout: 10000 });
            let processInfo;
            try { processInfo = JSON.parse(query.stdout); } catch { /* fail closed below */ }
            if (query.status !== 0 || processInfo?.ParentProcessId !== state.cliPid
                || !processInfo.CommandLine?.includes('cloud-firestore-emulator-')
                || !processInfo.CommandLine.includes(demoProjectId)) {
                throw new Error('Java process ownership could not be verified; no process was terminated.');
            }
        }
        const stopped = spawnSync('taskkill.exe', ['/PID', String(state.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
        if (stopped.status !== 0) throw new Error(`Windows denied cleanup of this run's emulator. Run Stop-Process -Id ${state.pid} -Force in your PowerShell session. ${stopped.stderr.trim()}`);
    } else {
        try { process.kill(state.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
}
function interrupt() {
    interrupted = true;
    child?.kill('SIGTERM');
}

function stopOwnedFunctionsWorkers() {
    if (!workersPath || !fs.existsSync(workersPath)) return;
    const state = JSON.parse(fs.readFileSync(workersPath, 'utf8'));
    if (state.token !== token || state.cliPid !== child?.pid) throw new Error('Invalid Functions worker ownership record.');
    for (const worker of state.workers) {
        if (!Number.isInteger(worker.pid) || worker.pid <= 0 || !['functionsEmulatorRuntime', 'firebase-functions.js'].includes(worker.marker))
            throw new Error('Invalid Functions worker identity.');
        try { process.kill(worker.pid, 0); } catch (error) { if (error.code === 'ESRCH') continue; throw error; }
        if (process.platform !== 'win32') {
            // Without a portable parent/command check, fail rather than target an unverifiable PID.
            throw new Error('Functions worker survived CLI shutdown; ownership verification required.');
        }
        const query = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            `$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter 'ProcessId=${worker.pid}' | Select-Object ParentProcessId,CommandLine | ConvertTo-Json -Compress`],
            { encoding: 'utf8', windowsHide: true, timeout: 10000 });
        let info;
        try { info = JSON.parse(query.stdout); } catch { /* fail closed */ }
        if (query.status !== 0 || info?.ParentProcessId !== state.cliPid || !info.CommandLine?.includes(worker.marker))
            throw new Error('Cannot prove ownership of surviving Functions worker.');
        const stopped = spawnSync('taskkill.exe', ['/PID', String(worker.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
        if (stopped.status !== 0) throw new Error('Owned Functions worker cleanup failed.');
    }
}

let result = 1;
try {
    assertEmulatorEnvironment(process.env, { requireHost: false });
    const mode = process.argv[2];
    if (process.argv.length > 3 || (mode && !['--verify-failure-cleanup', '--persistence', '--v2-security', '--server', '--callable', '--update-callable', '--all'].includes(mode))) throw new Error('Unexpected harness argument.');
    const needsFunctions = ['--all', '--callable', '--update-callable', '--verify-failure-cleanup'].includes(mode);
    const needsAuth = needsFunctions || mode === '--server';
    if (needsAuth) { ports = [8080, 9099]; assertServerEmulatorEnvironment(process.env, { requireHost: false }); }
    if (needsFunctions) { ports.push(5001); assertFunctionsEmulatorEnvironment(process.env, { requireHost: false }); }
    const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
    if (config.emulators?.firestore?.host !== '127.0.0.1' || config.emulators?.firestore?.port !== 8080) {
        throw new Error('Expected configured Firestore emulator at 127.0.0.1:8080.');
    }
    if (needsAuth && (config.emulators?.auth?.host !== '127.0.0.1' || config.emulators?.auth?.port !== 9099))
        throw new Error('Expected configured Auth emulator at 127.0.0.1:9099.');
    if (needsFunctions && (config.emulators?.functions?.host !== '127.0.0.1' || config.emulators?.functions?.port !== 5001)) throw new Error('Expected local Functions emulator on 5001.');
    const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/firebase-tools/package.json'), 'utf8')).version;
    if (version !== '15.29.0') throw new Error(`Review the startup compatibility hook for firebase-tools ${version}; expected 15.29.0.`);
    takeLock();
    for (const port of ports) if (!await portFree(port)) throw new Error(`Port 127.0.0.1:${port} is occupied; this harness will not reuse it, change ports or kill a pre-existing process.`);
    const run = path.join(work, token);
    fs.mkdirSync(run);
    statePath = path.join(run, 'emulator.json');
    workersPath = path.join(run, 'functions-workers.json');
    output = fs.createWriteStream(path.join(run, 'cli-output.log'));
    const env = { ...process.env, CI: 'true', GCLOUD_PROJECT: demoProjectId,
        FIREBASE_DEBUG_PATH: path.join(run, 'firebase-debug.log'), XDG_CONFIG_HOME: path.join(run, 'config'),
        BUSINESSBOSS_EMULATOR_STATE: statePath, BUSINESSBOSS_EMULATOR_TOKEN: token, BUSINESSBOSS_FUNCTIONS_WORKERS: workersPath };
    if (needsFunctions) Object.assign(env, { BUSINESSBOSS_LOCAL_FUNCTIONS: 'true', FUNCTIONS_DISCOVERY_TIMEOUT: '120', FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' });
    env.FIREBASE_EMULATORS_PATH ||= path.join(root, '.firebase', 'emulators');
    const javaHome = env.BUSINESSBOSS_JAVA_HOME || env.JAVA_HOME;
    if (javaHome) {
        const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
        env[pathKey] = path.join(javaHome, 'bin') + path.delimiter + (env[pathKey] || '');
    }
    if (process.platform === 'win32') {
        // Canonical writable path avoids the short-name temporary path socket issue.
        const socketRoot = env.BUSINESSBOSS_JAVA_TMPDIR || os.tmpdir();
        fs.mkdirSync(socketRoot, { recursive: true });
        javaTemp = fs.realpathSync.native(fs.mkdtempSync(path.join(socketRoot, 'bb-')));
        if (javaTemp.startsWith('\\\\?\\')) javaTemp = javaTemp.slice(4);
        if (javaTemp.length > 80) throw new Error('Java socket temporary directory is too long; set BUSINESSBOSS_JAVA_TMPDIR to a shorter writable directory.');
        env.JAVA_TOOL_OPTIONS = `${env.JAVA_TOOL_OPTIONS || ''} "-Djdk.net.unixdomain.tmpdir=${javaTemp}"`.trim();
    }
    // Suites clear the same demo database and load their own rules. Run sequentially.
    const script = mode === '--verify-failure-cleanup' ? 'node -e "process.exit(23)"'
        : mode === '--persistence' ? 'node --test tests/invoiceDraftPersistence.test.mjs'
        : mode === '--v2-security' ? 'node --test tests/invoiceV2SecurityRules.test.mjs'
        : mode === '--update-callable' ? 'node --test tests/updateInvoiceDraftCallable.test.mjs'
        : mode === '--callable' ? 'node --test --test-concurrency=1 tests/saveInvoiceDraftCallable.test.mjs tests/updateInvoiceDraftCallable.test.mjs'
        : mode === '--server' ? 'node --test --test-concurrency=1 tests/saveInvoiceDraftServerHandler.test.mjs tests/updateInvoiceDraftPersistence.test.mjs'
        : mode === '--all' ? 'node --test --test-concurrency=1 tests/firestoreRules.test.mjs tests/invoiceDraftPersistence.test.mjs tests/invoiceV2SecurityRules.test.mjs tests/saveInvoiceDraftServerHandler.test.mjs tests/saveInvoiceDraftCallable.test.mjs tests/updateInvoiceDraftPersistence.test.mjs tests/updateInvoiceDraftCallable.test.mjs'
        : 'node --test tests/firestoreRules.test.mjs';
    console.log(`Starting isolated rules run (${demoProjectId}, ${emulatorHost}). Logs: ${run}`);
    child = spawn(process.execPath, ['--require', path.join(root, 'tests/emulatorStartup.cjs'),
        path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'), 'emulators:exec',
        '--only', needsFunctions ? 'firestore,auth,functions' : needsAuth ? 'firestore,auth' : 'firestore', '--project', demoProjectId, '--non-interactive', '--debug', script],
        { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', data => { output.write(data); process.stdout.write(data); });
    child.stderr.on('data', data => { output.write(data); process.stderr.write(data); });
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    watchdog = setTimeout(() => { console.error('Rules harness exceeded its 20-minute run budget.'); interrupt(); }, 20 * 60_000);
    // exit, not close: a crashed CLI can leave a Java descendant holding a pipe.
    result = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve(signal || code === null ? 1 : code));
    });
    if (interrupted) result = 130;
} catch (error) {
    console.error(error.stack || error);
    result = 1;
} finally {
    clearTimeout(watchdog);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (child) {
        try { stopOwnedFunctionsWorkers(); }
        catch (error) { console.error(error.message); result = 1; }
        try {
            if (!await waitForFreePort(10_000)) {
                console.error('CLI left its emulator running; cleaning up only this run\'s recorded process.');
                stopOwnedEmulator();
            }
            // A free port does not prove that a still-starting Java child exited.
            stopOwnedEmulator();
            if (!await waitForFreePort(10_000)) throw new Error('Port 8080 is still occupied after cleanup.');
            console.log('Verified: port 127.0.0.1:8080 is free after rules run.');
            // Auth is an HTTP server inside the owned CLI process (not a child).
            // After CLI exit it cannot survive. Never kill a new occupant's PID.
            if (ports.includes(9099)) {
                if (!await waitForFreePort(10_000, 9099)) throw new Error('Port 9099 is still occupied after owned CLI exit.');
                console.log('Verified: port 127.0.0.1:9099 is free after rules run.');
            }
            if (ports.includes(5001)) {
                if (!await waitForFreePort(10_000, 5001)) throw new Error('Port 5001 still occupied after owned CLI exit.');
                console.log('Verified: port 127.0.0.1:5001 is free after rules run.');
            }
        } catch (error) { console.error(error.stack || error); result = 1; }
        child.stdout?.destroy(); child.stderr?.destroy();
    }
    output?.end();
    if (locked) {
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (lock.token === token) fs.unlinkSync(lockPath);
    }
    if (javaTemp) {
        try { fs.rmdirSync(javaTemp); } catch { console.error(`Temporary socket directory retained: ${javaTemp}`); }
    }
}
process.exitCode = result;
