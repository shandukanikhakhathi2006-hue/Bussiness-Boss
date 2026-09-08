import { setTimeout as delay } from 'node:timers/promises';

export const emulatorHost = '127.0.0.1:8080';
export const demoProjectId = 'demo-businessboss-rules';

export function assertEmulatorEnvironment(env, { requireHost = true } = {}) {
    if ((requireHost || env.FIRESTORE_EMULATOR_HOST !== undefined)
        && env.FIRESTORE_EMULATOR_HOST !== emulatorHost) {
        throw new Error(`Rules tests require FIRESTORE_EMULATOR_HOST=${emulatorHost}. Run npm run test:rules.`);
    }
    for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
        if (env[key] && env[key] !== demoProjectId) throw new Error(`${key} must be ${demoProjectId} for rules tests.`);
    }
    if (env.FIREBASE_CONFIG) {
        let config;
        try { config = JSON.parse(env.FIREBASE_CONFIG); } catch { throw new Error('FIREBASE_CONFIG must be demo-project JSON for rules tests.'); }
        if (config?.projectId !== demoProjectId) throw new Error(`FIREBASE_CONFIG must use ${demoProjectId}.`);
    }
}

// A listening socket is not necessarily an HTTP-ready Firestore emulator.
// Bound each request and the total budget; never fall back to a remote host.
export async function waitForFirestore({ timeoutMs = 30_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://${emulatorHost}/`, {
                signal: AbortSignal.timeout(Math.max(1, Math.min(3000, deadline - Date.now())))
            });
            await response.body?.cancel();
            if (response.ok) return;
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) { lastError = error; }
        if (Date.now() < deadline) await delay(Math.min(250, deadline - Date.now()));
    }
    throw new Error(`Local Firestore emulator at ${emulatorHost} was not HTTP-ready within ${timeoutMs}ms.`, { cause: lastError });
}
