import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { assertServerEmulatorEnvironment } from './emulatorSafety.js';
import { snapshot, validateEnvelope, identity, fail, safeError } from './invoiceDraftBoundary.js';
import { authorizeAndPrepareInvoiceDraftCommand } from '../js/backend/invoiceDraftCommand.js';
import { authorizeAndPrepareInvoiceDraftUpdate, InvoiceDraftUpdateCommandError } from '../js/backend/invoiceDraftUpdateCommand.js';

const messages = {
    BUSINESS_ACCESS_DENIED: 'Business access denied.', BUSINESS_NOT_FOUND: 'Business not found.',
    BUSINESS_INACTIVE: 'Business is inactive.', INVALID_BUSINESS_ROLE: 'Owner role required.',
    INVOICE_NOT_FOUND: 'Invoice not found.', INVOICE_NOT_EDITABLE: 'Invoice is not editable.',
    INVOICE_REVISION_CONFLICT: 'Invoice changed. Reload before saving.', INVALID_REQUEST: 'Invalid request.',
    INVALID_INVOICE_DRAFT: 'Invalid invoice draft.', REFERENCE_NOT_SUPPORTED: 'Linked references are not supported.',
    UNAVAILABLE: 'Service temporarily unavailable.', INTERNAL: 'Unable to update invoice draft.'
};
export class InvoiceDraftUpdatePersistenceError extends Error {
    constructor(code) {
        super(messages[code] || messages.INTERNAL);
        this.name = 'InvoiceDraftUpdatePersistenceError';
        this.code = Object.hasOwn(messages, code) ? code : 'INTERNAL';
        delete this.stack;
    }
}
const reject = code => { throw new InvoiceDraftUpdatePersistenceError(code); };

export function safeUpdateError(error) {
    if (error instanceof InvoiceDraftUpdatePersistenceError) return error;
    const mapped = error instanceof InvoiceDraftUpdateCommandError ? error : safeError(error);
    const result = new InvoiceDraftUpdatePersistenceError(mapped.code);
    // Both domain/boundary modules already restrict these details to known codes/paths.
    if (mapped.domainCode) result.domainCode = mapped.domainCode;
    if (mapped.path) result.path = mapped.path;
    return result;
}

function freezePlain(value) {
    if (value && typeof value === 'object' && (Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value)))) {
        Object.values(value).forEach(freezePlain);
        Object.freeze(value);
    }
    return value;
}

/** Internal guarded transaction callback, shared by local server wrappers and retry tests.
 * db/transaction/command must be trusted, guarded local objects, never wire input.
 */
export async function updateDraftInTransaction(transaction, db, command, assertEnvironment = () => {}) {
    assertServerEmulatorEnvironment(process.env);
    assertEnvironment();
    const { businessId, invoiceId, verifiedUid, expectedRevision, input } = command;
    const businessRef = db.collection('businesses').doc(businessId);
    const memberRef = businessRef.collection('members').doc(verifiedUid);
    const target = businessRef.collection('invoices').doc(invoiceId);
    const [businessSnapshot, memberSnapshot] = await transaction.getAll(businessRef, memberRef);
    const member = memberSnapshot.data();
    // Snapshot admission matches the existing create repository's disclosure policy.
    if (!member || member.uid !== verifiedUid || member.active !== true || typeof member.role !== 'string' || !member.role)
        fail('BUSINESS_ACCESS_DENIED');
    if (!businessSnapshot.exists) fail('BUSINESS_NOT_FOUND');
    const business = businessSnapshot.data();
    if (!identity(business.ownerId) || typeof business.active !== 'boolean'
        || (Object.hasOwn(business, 'archived') && typeof business.archived !== 'boolean')) fail('INTERNAL');
    if (Object.hasOwn(business, 'timezone')) {
        if (typeof business.timezone !== 'string' || !business.timezone || business.timezone.trim() !== business.timezone) fail('INTERNAL');
        try { new Intl.DateTimeFormat('en', { timeZone: business.timezone }); } catch { fail('INTERNAL'); }
    }
    if (!business.active || business.archived === true) fail('BUSINESS_INACTIVE');
    const authContext = { uid: verifiedUid };
    const businessContext = { businessId, ownerId: business.ownerId, role: member.role };
    // Reuse 9B before disclosing target existence. 9I repeats its own preparation
    // against the real snapshot below; neither result is cached across attempts.
    authorizeAndPrepareInvoiceDraftCommand({ authContext, businessContext, input });
    const invoiceSnapshot = await transaction.get(target);
    if (!invoiceSnapshot.exists) reject('INVOICE_NOT_FOUND');
    const stored = invoiceSnapshot.data();
    const plain = { ...stored };
    for (const field of ['createdAt', 'updatedAt']) {
        const stamp = stored[field];
        // A stored map masquerading as a Timestamp must not become valid evidence.
        plain[field] = stamp instanceof Timestamp ? { seconds: stamp.seconds, nanoseconds: stamp.nanoseconds } : null;
    }
    const prepared = authorizeAndPrepareInvoiceDraftUpdate({
        authContext, businessContext, businessId, invoiceId,
        storedInvoice: freezePlain(plain), expectedRevision, input
    });
    const draft = prepared.draft;
    assertServerEmulatorEnvironment(process.env);
    assertEnvironment();
    transaction.update(target, {
        customer: { id: null, name: draft.customerName, email: draft.customerEmail, address: draft.customerAddress },
        currency: draft.currency, issueDate: draft.issueDate, dueDate: draft.dueDate,
        lineItems: draft.lineItems.map(line => ({
            id: line.id, description: line.description, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor,
            discountMinor: line.discountMinor, taxRateBps: line.taxRateBps, taxCode: line.taxCode, catalogItemId: null,
            subtotalMinor: line.subtotalMinor, taxMinor: line.taxMinor, totalMinor: line.totalMinor
        })),
        ...draft.totals, balanceDueMinor: draft.totals.totalMinor,
        revision: prepared.nextRevision, updatedBy: prepared.actorUid, updatedAt: FieldValue.serverTimestamp()
    });
    return { invoiceId, revision: prepared.nextRevision };
}

/** Repository for trusted server callers ONLY. verifiedUid is already verified
 * by its caller; this is not authentication or a callable. Internal composition ONLY: admin and
 * assertEnvironment come from fixed local server wrappers, never request data.
 * The mandatory emulator guard cannot be replaced by the additional runtime guard.
 */
export function createTrustedInvoiceDraftUpdateRepository(admin, assertEnvironment = () => {}) {
    assertServerEmulatorEnvironment(process.env);
    assertEnvironment();
    let closed = false;
    return {
        async updateInvoiceDraftTransaction(request) {
            try {
                assertServerEmulatorEnvironment(process.env);
                assertEnvironment();
                if (closed) reject('UNAVAILABLE');
                const command = snapshot(request);
                const fields = ['businessId', 'invoiceId', 'verifiedUid', 'expectedRevision', 'input'];
                if (!command || Array.isArray(command) || Object.keys(command).length !== fields.length
                    || !fields.every(field => Object.hasOwn(command, field))) reject('INVALID_REQUEST');
                if (!identity(command.verifiedUid) || command.verifiedUid.includes('/')) reject('INVALID_REQUEST');
                validateEnvelope({ businessId: command.businessId, invoiceId: command.invoiceId, draft: command.input });
                // Positive-revision validation belongs to 9I; do not duplicate it here.
                freezePlain(command);
                return await admin.db.runTransaction(transaction => updateDraftInTransaction(transaction, admin.db, command, assertEnvironment));
            } catch (error) { throw safeUpdateError(error); }
        },
        async close() { if (!closed) { closed = true; await admin.close?.(); } }
    };
}
