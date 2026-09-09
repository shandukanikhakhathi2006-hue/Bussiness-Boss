import { createDraftInTransaction as create } from '../../server/invoiceDraftRepository.js';
import { assertServerEmulatorEnvironment } from '../emulatorEnvironment.mjs';
export const createDraftInTransaction = (transaction, db, uid, data) =>
    create(transaction, db, uid, data, () => assertServerEmulatorEnvironment(process.env));
