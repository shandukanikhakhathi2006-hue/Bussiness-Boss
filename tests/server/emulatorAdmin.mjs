import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from 'firebase-admin/firestore';
import { assertServerEmulatorEnvironment, demoProjectId, emulatorHost } from '../emulatorEnvironment.mjs';

// Development only. A synthetic emulator credential prevents ADC discovery.
// No caller-provided project, host, credential, app or database is accepted.
export function createEmulatorAdmin() {
    assertServerEmulatorEnvironment(process.env);
    const app = initializeApp({ projectId: demoProjectId, credential: {
        async getAccessToken() {
            assertServerEmulatorEnvironment(process.env);
            return { access_token: 'owner', expires_in: 3600 };
        }
    } }, `invoice-server-${randomUUID()}`);
    // Admin's getFirestore(app) only accepts ADC/certificate credentials. Use its
    // exported server Firestore constructor with explicit emulator-only options.
    const db = new Firestore({ projectId: demoProjectId, host: emulatorHost, ssl: false,
        credentials: { client_email: 'emulator@example.test', private_key: 'emulator-only-not-a-key' } });
    return { db, auth: getAuth(app), async close() { await db.terminate(); await deleteApp(app); } };
}
