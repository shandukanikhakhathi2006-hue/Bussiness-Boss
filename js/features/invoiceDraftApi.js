import { editableDraft } from './invoiceDraftState.js';
import { DEMO_PROJECT_ID } from '../firebase/clientEnvironment.js';

// No Admin SDK, Firestore access, token extraction or authority context. The
// injected functions object is the single browser app's Functions instance.
export function createInvoiceDraftApi({ functions, httpsCallable, environment, getCurrentUser }) {
    const invoke = async (name, data) => {
        if (!environment.local || environment.projectId !== DEMO_PROJECT_ID) throw new Error('Invoice v2 is local-only.');
        if (!getCurrentUser()?.uid) throw new Error('Sign in to the local demo first.');
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
