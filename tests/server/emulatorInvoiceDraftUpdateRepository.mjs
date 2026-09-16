import { createEmulatorAdmin } from './emulatorAdmin.mjs';
import { createTrustedInvoiceDraftUpdateRepository } from '../../server/invoiceDraftUpdateRepository.js';
export { updateDraftInTransaction, safeUpdateError, InvoiceDraftUpdatePersistenceError } from '../../server/invoiceDraftUpdateRepository.js';

// No caller-provided database/project/credentials. The transaction has one canonical source.
export function createEmulatorInvoiceDraftUpdateRepository() {
    return createTrustedInvoiceDraftUpdateRepository(createEmulatorAdmin());
}
