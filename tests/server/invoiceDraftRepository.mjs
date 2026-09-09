import { FieldValue } from 'firebase-admin/firestore';
import { authorizeAndPrepareInvoiceDraftCommand } from '../../js/backend/invoiceDraftCommand.js';
import { assertServerEmulatorEnvironment } from '../emulatorEnvironment.mjs';
import { fail, identity } from './invoiceDraftBoundary.mjs';

// Internal transaction callback. The public handler alone establishes uid.
// Exported for deterministic retry tests; never accepts authority from requests.
export async function createDraftInTransaction(transaction, db, uid, data) {
    assertServerEmulatorEnvironment(process.env);
    const businessRef = db.collection('businesses').doc(data.businessId);
    const memberRef = businessRef.collection('members').doc(uid);
    const target = businessRef.collection('invoices').doc(data.invoiceId);
    const [businessSnapshot, memberSnapshot] = await transaction.getAll(businessRef, memberRef);
    const member = memberSnapshot.data();
    if (!member || member.uid !== uid || member.active !== true || typeof member.role !== 'string' || !member.role)
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
    const command = authorizeAndPrepareInvoiceDraftCommand({
        authContext: { uid }, businessContext: { businessId: data.businessId, ownerId: business.ownerId, role: member.role },
        input: data.draft
    });
    const draft = command.draft;
    if (draft.customerId !== null || draft.lineItems.some(line => line.catalogItemId !== null)) fail('REFERENCE_NOT_SUPPORTED');
    if ((await transaction.get(target)).exists) fail('INVOICE_ALREADY_EXISTS');
    assertServerEmulatorEnvironment(process.env);
    transaction.create(target, {
        schemaVersion: 2, businessId: command.businessId, ownerId: command.ownerId,
        lifecycleStatus: 'draft', paymentStatus: 'not_due',
        customer: { id: null, name: draft.customerName, email: draft.customerEmail, address: draft.customerAddress },
        currency: draft.currency, issueDate: draft.issueDate, dueDate: draft.dueDate,
        lineItems: draft.lineItems.map(line => ({
            id: line.id, description: line.description, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor,
            discountMinor: line.discountMinor, taxRateBps: line.taxRateBps, taxCode: line.taxCode, catalogItemId: null,
            subtotalMinor: line.subtotalMinor, taxMinor: line.taxMinor, totalMinor: line.totalMinor
        })),
        ...draft.totals, amountPaidMinor: 0, balanceDueMinor: draft.totals.totalMinor,
        createdBy: command.actorUid, updatedBy: command.actorUid,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    });
}
