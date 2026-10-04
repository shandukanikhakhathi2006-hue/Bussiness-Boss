import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js';
import { auth, functions } from './config.js';
import { DEMO_PROJECT_ID, PRODUCTION_PROJECT_ID } from './clientEnvironment.js';
import { getLocalBusinessContext } from './localBusinessContext.js';

// Safe routing data only. The callable derives identity and authority itself.
export async function ensureBusinessContext() {
    if (!auth.currentUser?.uid) throw Object.assign(new Error('Sign in again.'), { code: 'functions/unauthenticated' });
    const result = await httpsCallable(functions, 'ensureBusinessContext')({});
    return result.data;
}

// This returns routing data only. Each invoice callable independently verifies
// the resulting business route against trusted membership and business records.
export async function resolveInvoiceBusinessContext(environment, user) {
    if (!user?.uid || auth.currentUser?.uid !== user.uid) {
        throw Object.assign(new Error('Sign in again.'), { code: 'functions/unauthenticated' });
    }
    if (environment.local) return getLocalBusinessContext(environment, user);
    if (environment.projectId !== PRODUCTION_PROJECT_ID || environment.projectId === DEMO_PROJECT_ID) {
        throw new Error('Invoice v2 environment is unavailable.');
    }
    const context = await ensureBusinessContext();
    if (!context || typeof context.businessId !== 'string' || !context.businessId || context.status !== 'active') {
        throw new Error('Business unavailable.');
    }
    return Object.freeze({ businessId: context.businessId });
}
