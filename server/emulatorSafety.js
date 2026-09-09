
export const emulatorHost = '127.0.0.1:8080';
export const demoProjectId = 'demo-businessboss-rules';
export const authEmulatorHost = '127.0.0.1:9099';
export const functionsEmulatorHost = '127.0.0.1:5001';

export function assertFunctionsEmulatorEnvironment(env, { requireHost = true } = {}) {
    assertServerEmulatorEnvironment(env, { requireHost });
    if ((requireHost || env.FUNCTIONS_EMULATOR_HOST !== undefined)
        && env.FUNCTIONS_EMULATOR_HOST !== functionsEmulatorHost) throw new Error('Expected local Functions emulator configuration.');
}

// Never discover ADC or accept a real credential in this local server harness.
export function assertServerEmulatorEnvironment(env, { requireHost = true } = {}) {
    assertEmulatorEnvironment(env, { requireHost });
    if ((requireHost || env.FIREBASE_AUTH_EMULATOR_HOST !== undefined)
        && env.FIREBASE_AUTH_EMULATOR_HOST !== authEmulatorHost) throw new Error('Expected local Auth emulator configuration.');
    for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_KEYFILE_JSON', 'GCLOUD_KEYFILE_JSON',
        'FIREBASE_TOKEN', 'FIREBASE_SERVICE_ACCOUNT', 'GOOGLE_SERVICE_ACCOUNT_KEY']) {
        if (env[key] !== undefined) throw new Error('Credentials are forbidden in emulator server tests.');
    }
    if (env.FIREBASE_CONFIG) {
        const config = JSON.parse(env.FIREBASE_CONFIG);
        if (Object.keys(config).some(key => !['projectId', 'storageBucket', 'databaseURL'].includes(key))) {
            throw new Error('Unexpected emulator Firebase configuration.');
        }
        if (config.storageBucket && config.storageBucket !== `${demoProjectId}.appspot.com`)
            throw new Error('Unexpected emulator storage configuration.');
        if (config.databaseURL && config.databaseURL !== `https://${demoProjectId}.firebaseio.com`)
            throw new Error('Unexpected emulator database configuration.');
    }
}

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
