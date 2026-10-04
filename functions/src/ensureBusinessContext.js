import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { ensureInitialOwnerBusiness, BusinessContextError } from 'businessboss/server/businessContextRepository.js';
import { servicesForCurrentEnvironment } from './admin.js';

const codes = { UNAUTHENTICATED: 'unauthenticated', INVALID_REQUEST: 'invalid-argument', BUSINESS_ACCESS_DENIED: 'permission-denied', BUSINESS_INACTIVE: 'failed-precondition', BUSINESS_NOT_FOUND: 'not-found', BUSINESS_CONTEXT_CONFLICT: 'failed-precondition', INTERNAL: 'internal' };
const toCallable = error => {
    const code = error instanceof BusinessContextError ? error.code : 'INTERNAL';
    return new HttpsError(codes[code] || 'internal', code === 'UNAUTHENTICATED' ? 'Sign in again.' : code === 'BUSINESS_CONTEXT_CONFLICT' ? 'Your business context needs support.' : 'Unable to prepare your business context.', { code });
};

// No authority fields are accepted. Callable Auth is the only identity source.
export async function handleEnsureBusinessContext(request) {
    try {
        if (!request.auth?.uid || typeof request.auth.uid !== 'string' || !request.data || Array.isArray(request.data)
            || Object.getPrototypeOf(request.data) !== Object.prototype || Object.keys(request.data).length !== 0)
            throw new BusinessContextError(request.auth?.uid ? 'INVALID_REQUEST' : 'UNAUTHENTICATED');
        const { auth, db } = servicesForCurrentEnvironment();
        if (typeof request.auth.rawToken !== 'string') throw new BusinessContextError('UNAUTHENTICATED');
        const verified = await auth.verifyIdToken(request.auth.rawToken, true).catch(() => { throw new BusinessContextError('UNAUTHENTICATED'); });
        if (verified.uid !== request.auth.uid) throw new BusinessContextError('UNAUTHENTICATED');
        const context = await ensureInitialOwnerBusiness({ db, verifiedUid: verified.uid, FieldValue });
        return { businessId: context.businessId, status: context.status };
    } catch (error) { throw toCallable(error); }
}