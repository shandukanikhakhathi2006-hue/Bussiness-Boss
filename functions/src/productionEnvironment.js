import { PRODUCTION_PROJECT_ID } from 'businessboss/server/businessContextRepository.js';

export function assertProductionFunctionsEnvironment(env = process.env) {
    if (env.BUSINESSBOSS_LOCAL_FUNCTIONS === 'true' || env.GCLOUD_PROJECT !== PRODUCTION_PROJECT_ID
        || env.FUNCTIONS_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) {
        throw new Error('Production Functions must use the production Firebase project and must not use emulator hosts.');
    }
}