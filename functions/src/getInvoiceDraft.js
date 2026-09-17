import { HttpsError } from 'firebase-functions/v2/https';
import { snapshot, identity, fail, SaveInvoiceDraftError } from 'businessboss/server/invoiceDraftBoundary.js';
import { safeUpdateError } from 'businessboss/server/invoiceDraftUpdateRepository.js';
import { readInvoiceDraft, validateReadEnvelope } from 'businessboss/server/invoiceDraftReadRepository.js';
import { localServices } from './admin.js';
import { assertLocalFunctionsEnvironment } from './localEnvironment.js';

const codes = {
    UNAUTHENTICATED: 'unauthenticated', INVALID_REQUEST: 'invalid-argument', BUSINESS_ACCESS_DENIED: 'permission-denied',
    INVALID_BUSINESS_ROLE: 'permission-denied', BUSINESS_NOT_FOUND: 'not-found', INVOICE_NOT_FOUND: 'not-found',
    BUSINESS_INACTIVE: 'failed-precondition', INVOICE_NOT_EDITABLE: 'failed-precondition', UNAVAILABLE: 'unavailable', INTERNAL: 'internal'
};
export function readCallableError(error) {
    const safe = error instanceof SaveInvoiceDraftError && error.code === 'UNAUTHENTICATED' ? error : safeUpdateError(error);
    const code = Object.hasOwn(codes, safe.code) ? safe.code : 'INTERNAL';
    return new HttpsError(codes[code], code === 'INTERNAL' ? 'Unable to load invoice draft.' : safe.message, { code });
}

// Exclusively registered through onCall; callable Auth is the only identity source.
export async function handleGetInvoiceDraft(request) {
    try {
        if (!identity(request.auth?.uid) || request.auth.uid.includes('/') || typeof request.auth.rawToken !== 'string') fail('UNAUTHENTICATED');
        const verifiedUid = request.auth.uid;
        const data = validateReadEnvelope(snapshot(request.data));
        const { auth, db } = localServices();
        let verified;
        try { verified = await auth.verifyIdToken(request.auth.rawToken, true); }
        catch (error) {
            if (['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked',
                'auth/user-disabled', 'auth/user-not-found'].includes(error.code)) fail('UNAUTHENTICATED');
            throw error;
        }
        if (verified.uid !== verifiedUid) fail('UNAUTHENTICATED');
        return await readInvoiceDraft(db, verifiedUid, data,
            () => assertLocalFunctionsEnvironment(process.env, { invocation: true }));
    } catch (error) { throw readCallableError(error); }
}
