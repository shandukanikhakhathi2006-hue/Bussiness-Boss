import { setTimeout as delay } from 'node:timers/promises';
import { emulatorHost } from '../server/emulatorSafety.js';
export * from '../server/emulatorSafety.js';

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
