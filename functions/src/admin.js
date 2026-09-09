import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from 'firebase-admin/firestore';
import { assertLocalFunctionsEnvironment } from './localEnvironment.js';

let services;
export function localServices() {
    assertLocalFunctionsEnvironment(process.env, { invocation: true });
    if (!services) {
        const app = initializeApp({ projectId: 'demo-businessboss-rules', credential: {
            async getAccessToken() {
                assertLocalFunctionsEnvironment(process.env, { invocation: true });
                return { access_token: 'owner', expires_in: 3600 };
            }
        } }, 'businessboss-local-callable');
        services = { auth: getAuth(app), db: new Firestore({ projectId: 'demo-businessboss-rules',
            host: '127.0.0.1:8080', ssl: false,
            credentials: { client_email: 'emulator@example.test', private_key: 'emulator-only-not-a-key' } }) };
    }
    return services;
}
