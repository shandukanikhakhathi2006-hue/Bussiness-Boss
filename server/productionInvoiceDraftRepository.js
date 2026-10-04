import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { snapshot, validateEnvelope, identity, fail } from './invoiceDraftBoundary.js';
import { resolveTrustedBusinessContext } from './businessContextRepository.js';
import { authorizeAndPrepareInvoiceDraftCommand } from '../js/backend/invoiceDraftCommand.js';
import { authorizeAndPrepareInvoiceDraftUpdate, validateStoredInvoiceDraft } from '../js/backend/invoiceDraftUpdateCommand.js';
import { InvoiceDraftUpdatePersistenceError, safeUpdateError } from './invoiceDraftUpdateRepository.js';

const freezePlain = value => {
    if (value && typeof value === 'object' && (Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value)))) {
        Object.values(value).forEach(freezePlain); Object.freeze(value);
    }
    return value;
};
const assertVerifiedUid = uid => {
    if (!identity(uid) || uid.includes('/')) fail('UNAUTHENTICATED');
};
const invoiceRef = (db, businessId, invoiceId) => db.collection('businesses').doc(businessId).collection('invoices').doc(invoiceId);
const storedLines = lines => lines.map(line => ({
    id: line.id, description: line.description, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor,
    discountMinor: line.discountMinor, taxRateBps: line.taxRateBps, taxCode: line.taxCode, catalogItemId: null,
    subtotalMinor: line.subtotalMinor, taxMinor: line.taxMinor, totalMinor: line.totalMinor
}));
const storedDraft = draft => ({
    customer: { id: null, name: draft.customerName, email: draft.customerEmail, address: draft.customerAddress },
    currency: draft.currency, issueDate: draft.issueDate, dueDate: draft.dueDate, lineItems: storedLines(draft.lineItems)
});
const projection = (invoiceId, stored) => ({
    invoiceId, lifecycleStatus: 'draft', revision: stored.revision,
    draft: {
        customerId: null, customerName: stored.customer.name, customerEmail: stored.customer.email, customerAddress: stored.customer.address,
        currency: stored.currency, issueDate: stored.issueDate, dueDate: stored.dueDate,
        lineItems: stored.lineItems.map(line => ({
            id: line.id, description: line.description, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor,
            discountMinor: line.discountMinor, taxRateBps: line.taxRateBps, taxCode: line.taxCode, catalogItemId: null
        }))
    },
    totals: { subtotalMinor: stored.subtotalMinor, discountMinor: stored.discountMinor, taxMinor: stored.taxMinor, totalMinor: stored.totalMinor }
});
function validateReadEnvelope(data) {
    if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).length !== 2
        || !['businessId', 'invoiceId'].every(key => Object.hasOwn(data, key))) fail('INVALID_REQUEST');
    validateEnvelope({ businessId: data.businessId, invoiceId: data.invoiceId, draft: null });
    return data;
}
function validateUpdateEnvelope(data) {
    const fields = ['businessId', 'invoiceId', 'expectedRevision', 'input'];
    if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).length !== fields.length
        || !fields.every(field => Object.hasOwn(data, field)) || typeof data.expectedRevision !== 'number'
        || !data.input || Array.isArray(data.input) || typeof data.input !== 'object') fail('INVALID_REQUEST');
    validateEnvelope({ businessId: data.businessId, invoiceId: data.invoiceId, draft: data.input });
    return data;
}

// Production-only adapter. It receives an Admin Firestore instance from the
// production Functions composition and resolves tenant authority in every transaction.
export async function createProductionInvoiceDraft(db, verifiedUid, request) {
    assertVerifiedUid(verifiedUid);
    const data = validateEnvelope(snapshot(request));
    await db.runTransaction(async transaction => {
        const businessContext = await resolveTrustedBusinessContext(transaction, db, verifiedUid, data.businessId);
        const command = authorizeAndPrepareInvoiceDraftCommand({ authContext: { uid: verifiedUid }, businessContext, input: data.draft });
        const draft = command.draft;
        if (draft.customerId !== null || draft.lineItems.some(line => line.catalogItemId !== null)) fail('REFERENCE_NOT_SUPPORTED');
        const target = invoiceRef(db, data.businessId, data.invoiceId);
        if ((await transaction.get(target)).exists) fail('INVOICE_ALREADY_EXISTS');
        transaction.create(target, {
            schemaVersion: 2, businessId: command.businessId, ownerId: command.ownerId,
            lifecycleStatus: 'draft', paymentStatus: 'not_due', revision: 1,
            ...storedDraft(draft), ...draft.totals, amountPaidMinor: 0, balanceDueMinor: draft.totals.totalMinor,
            createdBy: command.actorUid, updatedBy: command.actorUid,
            createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
        });
    });
    return { invoiceId: data.invoiceId, lifecycleStatus: 'draft' };
}

export async function readProductionInvoiceDraft(db, verifiedUid, request) {
    assertVerifiedUid(verifiedUid);
    const data = Object.freeze(validateReadEnvelope(snapshot(request)));
    return db.runTransaction(async transaction => {
        const businessContext = await resolveTrustedBusinessContext(transaction, db, verifiedUid, data.businessId);
        authorizeAndPrepareInvoiceDraftCommand({ authContext: { uid: verifiedUid }, businessContext, input: { currency: 'ZAR', lineItems: [] } });
        const invoiceId = data.invoiceId;
        const invoiceSnapshot = await transaction.get(invoiceRef(db, data.businessId, invoiceId));
        if (!invoiceSnapshot.exists) throw new InvoiceDraftUpdatePersistenceError('INVOICE_NOT_FOUND');
        const stored = invoiceSnapshot.data(); const evidence = { ...stored };
        for (const key of ['createdAt', 'updatedAt']) {
            const stamp = stored[key]; evidence[key] = stamp instanceof Timestamp ? { seconds: stamp.seconds, nanoseconds: stamp.nanoseconds } : null;
        }
        validateStoredInvoiceDraft(evidence, data.businessId, businessContext.ownerId);
        return projection(invoiceId, stored);
    });
}

export async function updateProductionInvoiceDraft(db, verifiedUid, request) {
    try {
        assertVerifiedUid(verifiedUid);
        const data = validateUpdateEnvelope(snapshot(request));
        return await db.runTransaction(async transaction => {
            const businessContext = await resolveTrustedBusinessContext(transaction, db, verifiedUid, data.businessId);
            authorizeAndPrepareInvoiceDraftCommand({ authContext: { uid: verifiedUid }, businessContext, input: data.input });
            const target = invoiceRef(db, data.businessId, data.invoiceId);
            const invoiceSnapshot = await transaction.get(target);
            if (!invoiceSnapshot.exists) throw new InvoiceDraftUpdatePersistenceError('INVOICE_NOT_FOUND');
            const stored = invoiceSnapshot.data(); const evidence = { ...stored };
            for (const key of ['createdAt', 'updatedAt']) {
                const stamp = stored[key]; evidence[key] = stamp instanceof Timestamp ? { seconds: stamp.seconds, nanoseconds: stamp.nanoseconds } : null;
            }
            const prepared = authorizeAndPrepareInvoiceDraftUpdate({
                authContext: { uid: verifiedUid }, businessContext, businessId: data.businessId, invoiceId: data.invoiceId,
                storedInvoice: freezePlain(evidence), expectedRevision: data.expectedRevision, input: data.input
            });
            const draft = prepared.draft;
            transaction.update(target, {
                ...storedDraft(draft), ...draft.totals, balanceDueMinor: draft.totals.totalMinor,
                revision: prepared.nextRevision, updatedBy: prepared.actorUid, updatedAt: FieldValue.serverTimestamp()
            });
            return { invoiceId: data.invoiceId, revision: prepared.nextRevision };
        });
    } catch (error) { throw safeUpdateError(error); }
}
