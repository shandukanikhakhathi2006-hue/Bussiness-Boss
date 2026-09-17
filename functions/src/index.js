import { onCall } from 'firebase-functions/v2/https';
import { callableOptions } from './localEnvironment.js';
import { handleSaveInvoiceDraft } from './saveInvoiceDraft.js';
import { handleUpdateInvoiceDraft } from './updateInvoiceDraft.js';
import { handleGetInvoiceDraft } from './getInvoiceDraft.js';

export const saveInvoiceDraft = onCall(callableOptions(), handleSaveInvoiceDraft);

export const updateInvoiceDraft = onCall(callableOptions(), handleUpdateInvoiceDraft);

export const getInvoiceDraft = onCall(callableOptions(), handleGetInvoiceDraft);
