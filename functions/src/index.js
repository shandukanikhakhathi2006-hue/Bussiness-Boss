import { onCall } from 'firebase-functions/v2/https';
import { callableOptions } from './localEnvironment.js';
import { handleSaveInvoiceDraft } from './saveInvoiceDraft.js';

export const saveInvoiceDraft = onCall(callableOptions(), handleSaveInvoiceDraft);
