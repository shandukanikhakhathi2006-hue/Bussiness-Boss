import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { assertLocalFunctionsEnvironment } from './localEnvironment.js';
import { assertProductionFunctionsEnvironment } from './productionEnvironment.js';

let local; let production;

export function localServices() {
    assertLocalFunctionsEnvironment(process.env, { invocation: true });
    if (!local) {
        const app = initializeApp({ projectId: 'demo-businessboss-rules', credential: {
            async getAccessToken() {
                assertLocalFunctionsEnvironment(process.env, { invocation: true });
                return { access_token: 'owner', expires_in: 3600 };
            }
        } }, 'businessboss-local-callable');
        local = { auth: getAuth(app), db: new Firestore({ projectId: 'demo-businessboss-rules',
            host: '127.0.0.1:8080', ssl: false,
            credentials: { client_email: 'emulator@example.test', private_key: 'emulator-only-not-a-key' } }) };
    }
    return local;
}

export function productionServices() {
    assertProductionFunctionsEnvironment(process.env);
    if (!production) {
        const name = 'businessboss-production-callable';
        const app = getApps().find(item => item.name === name) || initializeApp(undefined, name);
        production = { auth: getAuth(app), db: getFirestore(app) };
    }
    return production;
}

export function servicesForCurrentEnvironment() {
    return process.env.BUSINESSBOSS_LOCAL_FUNCTIONS === 'true' ? localServices() : productionServices();
}