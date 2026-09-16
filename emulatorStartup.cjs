// Isolated compatibility hook: the public CLI has no Firestore startup-timeout
// option. No dependency files are patched. Review this when upgrading the CLI.
const fs = require('node:fs');
const childProcess = require('node:child_process');
const originalSpawn = childProcess.spawn;
const activeWorkers = new Map();
function recordWorkers() {
    if (process.env.BUSINESSBOSS_FUNCTIONS_WORKERS) fs.writeFileSync(process.env.BUSINESSBOSS_FUNCTIONS_WORKERS,
        JSON.stringify({ cliPid: process.pid, token: process.env.BUSINESSBOSS_EMULATOR_TOKEN, workers: [...activeWorkers.values()] }));
}
childProcess.spawn = function (...args) {
    const child = originalSpawn.apply(this, args);
    const marker = ['functionsEmulatorRuntime', 'firebase-functions.js'].find(value => args[1]?.some?.(arg => String(arg).includes(value)));
    if (marker && child.pid && process.env.BUSINESSBOSS_FUNCTIONS_WORKERS) {
        activeWorkers.set(child.pid, { pid: child.pid, marker }); recordWorkers();
        child.once('exit', () => { activeWorkers.delete(child.pid); recordWorkers(); });
    }
    return child;
};
const version = require('firebase-tools/package.json').version;
if (version !== '15.29.0') throw new Error(`Review emulatorStartup.cjs before using firebase-tools ${version}; expected 15.29.0.`);
const { FirestoreEmulator } = require('firebase-tools/lib/emulator/firestoreEmulator');
const originalGetInfo = FirestoreEmulator.prototype.getInfo;
if (typeof originalGetInfo !== 'function') throw new Error('Incompatible FirestoreEmulator.getInfo API.');
FirestoreEmulator.prototype.getInfo = function () {
    const info = originalGetInfo.call(this);
    if (info.pid > 0 && process.env.BUSINESSBOSS_EMULATOR_STATE) {
        fs.writeFileSync(process.env.BUSINESSBOSS_EMULATOR_STATE, JSON.stringify({
            pid: info.pid, cliPid: process.pid, token: process.env.BUSINESSBOSS_EMULATOR_TOKEN
        }));
    }
    return { ...info, timeout: 300_000 };
};
