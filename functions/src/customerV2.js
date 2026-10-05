import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { snapshot } from 'businessboss/server/invoiceDraftBoundary.js';
import {
    archiveCustomer, createCustomer, customerRepositoryErrorCode, getCustomer,
    listCustomers, updateCustomer
} from 'businessboss/server/customerRepository.js';
import { servicesForCurrentEnvironment } from './admin.js';

const callableCodes = {
    UNAUTHENTICATED: 'unauthenticated', INVALID_REQUEST: 'invalid-argument', INVALID_CUSTOMER: 'invalid-argument',
    CUSTOMER_NOT_FOUND: 'not-found', CUSTOMER_ARCHIVED: 'failed-precondition', CUSTOMER_ALREADY_EXISTS: 'already-exists',
    BUSINESS_ACCESS_DENIED: 'permission-denied', BUSINESS_NOT_FOUND: 'not-found', BUSINESS_INACTIVE: 'failed-precondition', INTERNAL: 'internal'
};

const callableError = error => {
    const code = customerRepositoryErrorCode(error);
    return new HttpsError(callableCodes[code] || 'internal', code === 'UNAUTHENTICATED' ? 'Sign in again.' :
        code === 'INVALID_CUSTOMER' ? 'Check the customer details.' : code === 'CUSTOMER_NOT_FOUND' ? 'Customer not found.' :
            code === 'CUSTOMER_ARCHIVED' ? 'Archived customers cannot be changed.' : 'Unable to complete the customer request.', { code });
};

async function verifiedInvocation(request, operation) {
    try {
        if (!request.auth?.uid || typeof request.auth.uid !== 'string' || typeof request.auth.rawToken !== 'string') {
            throw Object.assign(new Error('UNAUTHENTICATED'), { code: 'UNAUTHENTICATED' });
        }
        const { auth, db } = servicesForCurrentEnvironment();
        const verified = await auth.verifyIdToken(request.auth.rawToken, true).catch(() => null);
        if (!verified || verified.uid !== request.auth.uid) throw Object.assign(new Error('UNAUTHENTICATED'), { code: 'UNAUTHENTICATED' });
        return await operation({ db, verifiedUid: verified.uid, data: snapshot(request.data), FieldValue });
    } catch (error) { throw callableError(error); }
}

export const handleCreateCustomer = request => verifiedInvocation(request, createCustomer);
export const handleGetCustomer = request => verifiedInvocation(request, getCustomer);
export const handleListCustomers = request => verifiedInvocation(request, listCustomers);
export const handleUpdateCustomer = request => verifiedInvocation(request, updateCustomer);
export const handleArchiveCustomer = request => verifiedInvocation(request, archiveCustomer);
