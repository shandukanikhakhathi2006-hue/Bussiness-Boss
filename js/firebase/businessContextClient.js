import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js';
import { auth, functions } from './config.js';

// Safe routing data only. The callable derives identity and authority itself.
export async function ensureBusinessContext() {
    if (!auth.currentUser?.uid) throw Object.assign(new Error('Sign in again.'), { code: 'functions/unauthenticated' });
    const result = await httpsCallable(functions, 'ensureBusinessContext')({});
    return result.data;
}