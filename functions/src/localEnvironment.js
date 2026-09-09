import { assertServerEmulatorEnvironment, demoProjectId } from 'businessboss/server/emulatorSafety.js';

export function assertLocalFunctionsEnvironment(env = process.env, { invocation = false } = {}) {
    assertServerEmulatorEnvironment(env);
    if (env.BUSINESSBOSS_LOCAL_FUNCTIONS !== 'true' || env.FUNCTIONS_EMULATOR_HOST !== '127.0.0.1:5001'
        || env.GCLOUD_PROJECT !== demoProjectId || (invocation && env.FUNCTIONS_EMULATOR !== 'true')) {
        throw new Error('Stage 9G requires the isolated local Functions runtime.');
    }
}

export function callableOptions(env = process.env) {
    const local = env.BUSINESSBOSS_LOCAL_FUNCTIONS === 'true';
    if (local) assertLocalFunctionsEnvironment(env);
    return { region: 'africa-south1', enforceAppCheck: !local, timeoutSeconds: 60, maxInstances: 2 };
}
