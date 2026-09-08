import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { assertEmulatorEnvironment, demoProjectId } from '../../tests/emulatorEnvironment.mjs';

// Stage 9C is intentionally a development-only emulator adapter. The established
// test guard and rules-disabled context prevent credentials/default app discovery.
// This is NOT a production endpoint and cannot establish command provenance.
export class InvoiceDraftPersistenceError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'InvoiceDraftPersistenceError';
        this.code = code;
    }
}

const fail = (message) => { throw new InvoiceDraftPersistenceError('INVALID_PREPARED_COMMAND', message); };
const string = value => typeof value === 'string';
const nullableString = value => value === null || string(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const identity = value => string(value) && value.length > 0;
const money = { subtotalMinor: integer, discountMinor: integer, taxMinor: integer, totalMinor: integer };
const lineShape = {
    id: string, description: string, quantity: string, unitPriceMinor: integer,
    discountMinor: integer, taxRateBps: integer, taxCode: string,
    catalogItemId: nullableString, subtotalMinor: integer, taxMinor: integer, totalMinor: integer
};

// Storage shape only: no identity authorization, currency/date/quantity parsing,
// normalization or recalculation. Own data fields are copied before any await.
function copyShape(value, shape, label) {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        fail(`${label} must be a plain data object.`);
    }
    if (Reflect.ownKeys(value).length !== Object.keys(shape).length) fail(`${label} has unexpected or missing fields.`);
    const copy = {};
    for (const [key, check] of Object.entries(shape)) {
        const field = Object.getOwnPropertyDescriptor(value, key);
        if (!field || !Object.hasOwn(field, 'value') || !check(field.value)) fail(`${label}.${key} has an invalid storage type.`);
        copy[key] = field.value;
    }
    return copy;
}

function pathSegment(value, label) {
    // Firestore IDs are single UTF-8 segments; percent signs remain literal SDK
    // IDs and cannot become URL/path separators. No normalization is performed.
    if (!identity(value) || value.includes('/') || value === '.' || value === '..'
        || /^__.*__$/.test(value) || value.trim() !== value
        || /[\u0000-\u001f\u007f-\u009f]/.test(value) || Buffer.byteLength(value, 'utf8') > 1500) {
        throw new InvoiceDraftPersistenceError('INVALID_DOCUMENT_PATH', `${label} must be a safe Firestore document segment.`);
    }
    return value;
}

function storedDraft(preparedCommand) {
    const command = copyShape(preparedCommand, {
        businessId: identity, ownerId: identity, actorUid: identity, draft: value => value !== null && typeof value === 'object'
    }, 'preparedCommand');
    pathSegment(command.businessId, 'businessId');
    const draft = copyShape(command.draft, {
        customerId: nullableString, customerName: string, customerEmail: nullableString,
        customerAddress: nullableString, currency: string, issueDate: nullableString,
        dueDate: nullableString, lineItems: Array.isArray, totals: value => value !== null && typeof value === 'object'
    }, 'draft');
    const lineItems = [];
    for (let index = 0; index < draft.lineItems.length; index += 1) {
        const field = Object.getOwnPropertyDescriptor(draft.lineItems, String(index));
        if (!field || !Object.hasOwn(field, 'value')) fail('lineItems must contain dense data entries.');
        lineItems.push(copyShape(field.value, lineShape, `lineItems[${index}]`));
    }
    const totals = copyShape(draft.totals, money, 'totals');
    return {
        schemaVersion: 2, businessId: command.businessId, ownerId: command.ownerId,
        lifecycleStatus: 'draft', paymentStatus: 'not_due',
        customer: { id: draft.customerId, name: draft.customerName, email: draft.customerEmail, address: draft.customerAddress },
        currency: draft.currency, issueDate: draft.issueDate, dueDate: draft.dueDate,
        lineItems, ...totals, amountPaidMinor: 0, balanceDueMinor: totals.totalMinor,
        createdBy: command.actorUid, updatedBy: command.actorUid,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
}

/**
 * Owns a fixed localhost/demo client; callers cannot inject a production db.
 * Only pass unmodified output of authorizeAndPrepareInvoiceDraftCommand using
 * trusted contexts. Structural checks do not authenticate a forged command.
 * The emulator's rules-disabled context models a future backend, not client ACLs.
 * Call close() after outstanding saves complete.
 */
export async function createEmulatorInvoiceDraftPersistence() {
    assertEmulatorEnvironment(process.env);
    const environment = await initializeTestEnvironment({
        projectId: demoProjectId, firestore: { host: '127.0.0.1', port: 8080 }
    });
    let closed = false;
    return {
        async saveInvoiceDraft({ preparedCommand, invoiceId } = {}) {
            assertEmulatorEnvironment(process.env);
            if (closed) throw new InvoiceDraftPersistenceError('ADAPTER_CLOSED', 'Persistence adapter is closed.');
            pathSegment(invoiceId, 'invoiceId');
            const data = storedDraft(preparedCommand);
            const targetPath = `businesses/${data.businessId}/invoices/${invoiceId}`;
            await environment.withSecurityRulesDisabled(async context => {
                const db = context.firestore();
                const target = doc(db, targetPath);
                await runTransaction(db, async transaction => {
                    if ((await transaction.get(target)).exists()) {
                        throw new InvoiceDraftPersistenceError('INVOICE_ALREADY_EXISTS', 'This invoice ID already exists.');
                    }
                    transaction.set(target, data);
                });
            });
            return { invoiceId, path: targetPath };
        },
        async close() {
            closed = true;
            await environment.cleanup();
        }
    };
}
