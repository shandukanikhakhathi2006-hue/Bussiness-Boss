import { editableDraft } from './invoiceDraftState.js';
import { DEMO_PROJECT_ID, PRODUCTION_PROJECT_ID } from '../firebase/clientEnvironment.js';

// No Admin SDK, Firestore access, token extraction or authority context. The
// injected functions object is the single browser app's Functions instance.
export function createInvoiceDraftApi({ functions, httpsCallable, environment, getCurrentUser }) {
    const invoke = async (name, data) => {
        const validEnvironment = environment.local
            ? environment.projectId === DEMO_PROJECT_ID
            : environment.projectId === PRODUCTION_PROJECT_ID;
        if (!validEnvironment) throw new Error('Invoice v2 environment is unavailable.');
        if (!getCurrentUser()?.uid) throw Object.assign(new Error('Sign in again.'), { code: 'functions/unauthenticated' });
        const result = await httpsCallable(functions, name)(data);
        return result.data;
    };
    return Object.freeze({
        saveInvoiceDraft: ({ businessId, invoiceId, draft }) => invoke('saveInvoiceDraft', { businessId, invoiceId, draft: editableDraft(draft) }),
        getInvoiceDraft: ({ businessId, invoiceId }) => invoke('getInvoiceDraft', { businessId, invoiceId }),
        updateInvoiceDraft: ({ businessId, invoiceId, expectedRevision, input }) => invoke('updateInvoiceDraft', {
            businessId, invoiceId, expectedRevision, input: editableDraft(input)
        })
    });
}
