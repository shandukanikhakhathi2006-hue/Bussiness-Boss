import { HttpsError } from 'firebase-functions/v2/https';
import { snapshot, validateEnvelope, identity, fail, safeError } from 'businessboss/server/invoiceDraftBoundary.js';
import { createDraftInTransaction } from 'businessboss/server/invoiceDraftRepository.js';
import { localServices } from './admin.js';
import { assertLocalFunctionsEnvironment } from './localEnvironment.js';

const codes = {
    UNAUTHENTICATED: 'unauthenticated', INVALID_REQUEST: 'invalid-argument', INVALID_INVOICE_DRAFT: 'invalid-argument',
    REFERENCE_NOT_SUPPORTED: 'failed-precondition', BUSINESS_ACCESS_DENIED: 'permission-denied', BUSINESS_NOT_FOUND: 'not-found',
    BUSINESS_INACTIVE: 'failed-precondition', INVALID_BUSINESS_ROLE: 'permission-denied', INVOICE_ALREADY_EXISTS: 'already-exists',
    UNAVAILABLE: 'unavailable', INTERNAL: 'internal'
};
export function callableError(error) {
    const safe = safeError(error);
    const details = { code: safe.code };
    if (safe.domainCode) details.domainCode = safe.domainCode;
    if (safe.path) details.path = safe.path;
    return new HttpsError(codes[safe.code], safe.message, details);
}

// Called exclusively by the onCall platform wrapper. Never export as a route.
export async function handleSaveInvoiceDraft(request) {
    try {
        if (!identity(request.auth?.uid) || request.auth.uid.includes('/') || typeof request.auth.rawToken !== 'string') fail('UNAUTHENTICATED');
        const data = snapshot(request.data);
        const { auth, db } = localServices();
        let verified;
        try {
            // Public AuthData.rawToken in pinned Functions 7.3.2. No header parsing
            // or token in application data. Preserve disabled/deleted/revoked checks.
            verified = await auth.verifyIdToken(request.auth.rawToken, true);
        } catch (error) {
            if (['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked',
                'auth/user-disabled', 'auth/user-not-found'].includes(error.code)) fail('UNAUTHENTICATED');
            throw error;
        }
        if (verified.uid !== request.auth.uid) fail('UNAUTHENTICATED');
        validateEnvelope(data);
        await db.runTransaction(transaction => createDraftInTransaction(transaction, db, request.auth.uid, data,
            () => assertLocalFunctionsEnvironment(process.env, { invocation: true })));
        return { invoiceId: data.invoiceId, lifecycleStatus: 'draft' };
    } catch (error) { throw callableError(error); }
}
