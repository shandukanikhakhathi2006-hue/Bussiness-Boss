import { Timestamp } from 'firebase-admin/firestore';
import { snapshot, validateEnvelope, identity, fail } from './invoiceDraftBoundary.js';
import { assertServerEmulatorEnvironment } from './emulatorSafety.js';
import { InvoiceDraftUpdatePersistenceError } from './invoiceDraftUpdateRepository.js';
import { authorizeAndPrepareInvoiceDraftCommand } from '../js/backend/invoiceDraftCommand.js';
import { validateStoredInvoiceDraft } from '../js/backend/invoiceDraftUpdateCommand.js';

export function validateReadEnvelope(data) {
    if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).length !== 2
        || !['businessId', 'invoiceId'].every(key => Object.hasOwn(data, key))) fail('INVALID_REQUEST');
    validateEnvelope({ businessId: data.businessId, invoiceId: data.invoiceId, draft: null });
    return data;
}

// Trusted internal callback, also used by consistency/no-write tests. Not a wire API.
export async function readDraftInTransaction(transaction, db, verifiedUid, data, assertEnvironment) {
    assertServerEmulatorEnvironment(process.env);
    assertEnvironment();
    const { businessId, invoiceId } = data;
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

    // Reuse owner/role policy with a known valid minimal candidate, before target disclosure.
    authorizeAndPrepareInvoiceDraftCommand({ authContext, businessContext, input: { currency: 'ZAR', lineItems: [] } });
    const invoiceSnapshot = await transaction.get(target);
    if (!invoiceSnapshot.exists) throw new InvoiceDraftUpdatePersistenceError('INVOICE_NOT_FOUND');
    const stored = invoiceSnapshot.data();
    const evidence = { ...stored };
    for (const key of ['createdAt', 'updatedAt']) {
        const stamp = stored[key];
        evidence[key] = stamp instanceof Timestamp ? { seconds: stamp.seconds, nanoseconds: stamp.nanoseconds } : null;
    }
    validateStoredInvoiceDraft(evidence, businessId, business.ownerId);
    assertServerEmulatorEnvironment(process.env);
    assertEnvironment();
    // Explicit projection only after full validation. Never return SDK snapshots or audit evidence.
    return {
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
    };
}

// Internal composition only: db and guard originate in the fixed local Functions adapter.
export async function readInvoiceDraft(db, verifiedUid, request, assertEnvironment) {
    assertServerEmulatorEnvironment(process.env);
    assertEnvironment();
    if (!identity(verifiedUid) || verifiedUid.includes('/')) fail('UNAUTHENTICATED');
    const data = Object.freeze(validateReadEnvelope(snapshot(request)));
    // Default read-write MODE supplies current pessimistic document locks. This callback
    // performs zero writes. Read-only MODE in this SDK permits snapshots up to 60s old.
    return db.runTransaction(transaction => readDraftInTransaction(transaction, db, verifiedUid, data, assertEnvironment));
}
