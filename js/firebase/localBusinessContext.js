import { DEMO_PROJECT_ID } from './clientEnvironment.js';

export const DEMO_BUSINESS_ID = 'stage9n-demo-business';

// Authenticated LOCAL session routing only. This does not assert membership,
// activity, ownership or role. Every callable verifies those on the server.
export function getLocalBusinessContext(environment, user) {
    if (!environment.local || environment.projectId !== DEMO_PROJECT_ID) {
        throw new Error('Local demo business routing is unavailable.');
    }
    if (!user?.uid) throw new Error('Sign in to the local demo first.');
    return Object.freeze({ businessId: DEMO_BUSINESS_ID });
}
