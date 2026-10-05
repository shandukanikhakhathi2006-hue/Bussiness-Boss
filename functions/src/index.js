import { onCall } from 'firebase-functions/v2/https';
import { callableOptions } from './localEnvironment.js';
import { handleSaveInvoiceDraft } from './saveInvoiceDraft.js';
import { handleUpdateInvoiceDraft } from './updateInvoiceDraft.js';
import { handleGetInvoiceDraft } from './getInvoiceDraft.js';
import { handleEnsureBusinessContext } from './ensureBusinessContext.js';
import { handleArchiveCustomer, handleCreateCustomer, handleGetCustomer, handleListCustomers, handleUpdateCustomer } from './customerV2.js';

export const ensureBusinessContext = onCall(callableOptions(), handleEnsureBusinessContext);
export const saveInvoiceDraft = onCall(callableOptions(), handleSaveInvoiceDraft);
export const updateInvoiceDraft = onCall(callableOptions(), handleUpdateInvoiceDraft);
export const getInvoiceDraft = onCall(callableOptions(), handleGetInvoiceDraft);
export const createCustomer = onCall(callableOptions(), handleCreateCustomer);
export const getCustomer = onCall(callableOptions(), handleGetCustomer);
export const listCustomers = onCall(callableOptions(), handleListCustomers);
export const updateCustomer = onCall(callableOptions(), handleUpdateCustomer);
export const archiveCustomer = onCall(callableOptions(), handleArchiveCustomer);
