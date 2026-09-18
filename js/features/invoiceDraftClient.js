import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js';
import { auth, functions, clientEnvironment } from '../firebase/config.js';
import { createInvoiceDraftApi } from './invoiceDraftApi.js';

export const { saveInvoiceDraft, getInvoiceDraft, updateInvoiceDraft } = createInvoiceDraftApi({
    functions, httpsCallable, environment: clientEnvironment, getCurrentUser: () => auth.currentUser
});
