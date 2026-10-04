import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { assertProductionFunctionsEnvironment } from '../functions/src/productionEnvironment.js';
import { handleEnsureBusinessContext } from '../functions/src/ensureBusinessContext.js';

const config = fs.readFileSync(new URL('../js/firebase/config.js', import.meta.url), 'utf8');
const appCheck = fs.readFileSync(new URL('../js/firebase/appCheck.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../js/firebase/businessContextClient.js', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../functions/src/admin.js', import.meta.url), 'utf8');
const handler = fs.readFileSync(new URL('../functions/src/ensureBusinessContext.js', import.meta.url), 'utf8');

test('production client initializes App Check only outside explicit local mode', () => {
    assert.match(config, /initializeProductionAppCheck/); assert.match(appCheck, /if \(environment\.local\) return null/);
    assert.match(appCheck, /ReCaptchaEnterpriseProvider/); assert.doesNotMatch(appCheck, /127\.0\.0\.1/);
});
test('business provisioning client sends no ownership or role authority', () => {
    assert.match(client, /httpsCallable\(functions, 'ensureBusinessContext'\)\(\{\}\)/);
    assert.doesNotMatch(client, /ownerId|role|status/);
});
test('production Admin composition is distinct from local emulator services', () => {
    assert.match(admin, /productionServices/); assert.match(admin, /getFirestore\(app\)/);
    assert.match(admin, /host: '127\.0\.0\.1:8080'/); assert.match(handler, /ensureInitialOwnerBusiness/);
    assert.match(handler, /verifyIdToken\(request\.auth\.rawToken, true\)/);
});
test('production composition rejects local markers and the wrong Firebase project', () => {
    assert.doesNotThrow(() => assertProductionFunctionsEnvironment({ GCLOUD_PROJECT: 'business-boss-1b871' }));
    for (const env of [
        { GCLOUD_PROJECT: 'demo-businessboss-rules' },
        { GCLOUD_PROJECT: 'business-boss-1b871', BUSINESSBOSS_LOCAL_FUNCTIONS: 'true' },
        { GCLOUD_PROJECT: 'business-boss-1b871', FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001' },
        { GCLOUD_PROJECT: 'business-boss-1b871', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
        { GCLOUD_PROJECT: 'business-boss-1b871', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }
    ]) assert.throws(() => assertProductionFunctionsEnvironment(env));
});
test('provisioning callable rejects missing Auth and authority fields before services are reached', async () => {
    await assert.rejects(() => handleEnsureBusinessContext({ auth: null, data: {} }), error => error.code === 'unauthenticated');
    await assert.rejects(() => handleEnsureBusinessContext({ auth: { uid: 'owner-a', rawToken: 'token' }, data: { ownerId: 'owner-a' } }), error => error.code === 'invalid-argument');
});
