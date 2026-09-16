import { HttpsError } from 'firebase-functions/v2/https';
import { snapshot, validateEnvelope, identity, fail, SaveInvoiceDraftError } from 'businessboss/server/invoiceDraftBoundary.js';
import { createTrustedInvoiceDraftUpdateRepository, safeUpdateError } from 'businessboss/server/invoiceDraftUpdateRepository.js';
import { localServices } from './admin.js';
import { assertLocalFunctionsEnvironment } from './localEnvironment.js';

const codes = {
    UNAUTHENTICATED: 'unauthenticated', INVALID_REQUEST: 'invalid-argument', INVALID_INVOICE_DRAFT: 'invalid-argument',
    REFERENCE_NOT_SUPPORTED: 'failed-precondition', BUSINESS_ACCESS_DENIED: 'permission-denied', BUSINESS_NOT_FOUND: 'not-found',
    BUSINESS_INACTIVE: 'failed-precondition', INVALID_BUSINESS_ROLE: 'permission-denied', INVOICE_NOT_FOUND: 'not-found',
    INVOICE_NOT_EDITABLE: 'failed-precondition', INVOICE_REVISION_CONFLICT: 'aborted', UNAVAILABLE: 'unavailable', INTERNAL: 'internal'
};
export function updateCallableError(error) {
    const safe = error instanceof SaveInvoiceDraftError && error.code === 'UNAUTHENTICATED' ? error : safeUpdateError(error);
    const details = { code: safe.code };
    if (safe.domainCode) details.domainCode = safe.domainCode;
    if (safe.path) details.path = safe.path;
    return new HttpsError(codes[safe.code], safe.message, details);
}

export function validateUpdateEnvelope(data) {
    const fields = ['businessId', 'invoiceId', 'expectedRevision', 'input'];
    if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).length !== fields.length
        || !fields.every(field => Object.hasOwn(data, field)) || typeof data.expectedRevision !== 'number'
        || !data.input || Array.isArray(data.input) || typeof data.input !== 'object') fail('INVALID_REQUEST');
    validateEnvelope({ businessId: data.businessId, invoiceId: data.invoiceId, draft: data.input });
    // Integer/range and invoice semantics remain exclusively in Stage 9I.
    return data;
}

// Internal, no-argument composition. Never accepts services or authority from wire data.
function localRepository() {
    return createTrustedInvoiceDraftUpdateRepository(localServices(),
        () => assertLocalFunctionsEnvironment(process.env, { invocation: true }));
}

// Called only by the Firebase v2 onCall wrapper, which establishes request.auth.
export async function handleUpdateInvoiceDraft(request) {
    try {
        if (!identity(request.auth?.uid) || request.auth.uid.includes('/') || typeof request.auth.rawToken !== 'string') fail('UNAUTHENTICATED');
        const verifiedUid = request.auth.uid;
        const data = validateUpdateEnvelope(snapshot(request.data));
        const { auth } = localServices();
        let verified;
        try { verified = await auth.verifyIdToken(request.auth.rawToken, true); }
        catch (error) {
            if (['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked',
                'auth/user-disabled', 'auth/user-not-found'].includes(error.code)) fail('UNAUTHENTICATED');
            throw error;
        }
        if (verified.uid !== verifiedUid) fail('UNAUTHENTICATED');
        const result = await localRepository().updateInvoiceDraftTransaction({
            businessId: data.businessId, invoiceId: data.invoiceId, expectedRevision: data.expectedRevision,
            input: data.input, verifiedUid
        });
        return { invoiceId: result.invoiceId, revision: result.revision };
    } catch (error) { throw updateCallableError(error); }
}
