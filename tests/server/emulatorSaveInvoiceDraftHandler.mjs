import { createEmulatorAdmin } from './emulatorAdmin.mjs';
import { types } from 'node:util';
import { createDraftInTransaction } from './invoiceDraftRepository.mjs';
import { assertServerEmulatorEnvironment } from '../emulatorEnvironment.mjs';
import { fail, snapshot, validateEnvelope, safeError, identity } from './invoiceDraftBoundary.mjs';
export { SaveInvoiceDraftError } from './invoiceDraftBoundary.mjs';

/** In-process LOCAL emulator driver, not a callable or a production server. */
export async function createEmulatorSaveInvoiceDraftHandler() {
    const admin = createEmulatorAdmin();
    let closed = false;
    return {
        async saveInvoiceDraft(request) {
            try {
                assertServerEmulatorEnvironment(process.env);
                if (closed) fail('UNAVAILABLE');
                if (!request || typeof request !== 'object' || types.isProxy(request)) fail('INVALID_REQUEST');
                const tokenField = Object.getOwnPropertyDescriptor(request, 'idToken');
                if (tokenField && !Object.hasOwn(tokenField, 'value')) fail('INVALID_REQUEST');
                if (!tokenField || typeof tokenField.value !== 'string' || !tokenField.value || tokenField.value.length > 16384) fail('UNAUTHENTICATED');
                // Snapshot before the first await, including all nested draft data.
                const copied = snapshot(request ?? {});
                if (!copied || typeof copied.idToken !== 'string' || !copied.idToken || copied.idToken.length > 16384) fail('UNAUTHENTICATED');
                let decoded;
                try {
                    decoded = await admin.auth.verifyIdToken(copied.idToken, true);
                } catch (error) {
                    if (['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired',
                        'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'].includes(error.code)) fail('UNAUTHENTICATED');
                    throw error;
                }
                assertServerEmulatorEnvironment(process.env);
                if (!identity(decoded.uid) || decoded.uid.includes('/')) fail('UNAUTHENTICATED');
                if (Array.isArray(copied) || Object.keys(copied).length !== 2 || !Object.hasOwn(copied, 'data')) fail('INVALID_REQUEST');
                const data = validateEnvelope(copied.data);
                await admin.db.runTransaction(transaction => createDraftInTransaction(transaction, admin.db, decoded.uid, data));
                return { invoiceId: data.invoiceId, lifecycleStatus: 'draft' };
            } catch (error) { throw safeError(error); }
        },
        async close() { if (!closed) { closed = true; await admin.close(); } }
    };
}
