import { onCall } from 'firebase-functions/v2/https';
import { callableOptions } from './localEnvironment.js';
import { handleSaveInvoiceDraft } from './saveInvoiceDraft.js';
import { handleUpdateInvoiceDraft } from './updateInvoiceDraft.js';
import { handleGetInvoiceDraft } from './getInvoiceDraft.js';
import { handleEnsureBusinessContext } from './ensureBusinessContext.js';

export const ensureBusinessContext = onCall(callableOptions(), handleEnsureBusinessContext);
export const saveInvoiceDraft = onCall(callableOptions(), handleSaveInvoiceDraft);
export const updateInvoiceDraft = onCall(callableOptions(), handleUpdateInvoiceDraft);
export const getInvoiceDraft = onCall(callableOptions(), handleGetInvoiceDraft);