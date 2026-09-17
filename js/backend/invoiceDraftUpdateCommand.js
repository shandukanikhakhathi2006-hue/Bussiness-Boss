import { authorizeAndPrepareInvoiceDraftCommand } from './invoiceDraftCommand.js';
import { validateInvoiceDraft, InvoiceDraftValidationError } from '../finance/invoiceDraftValidator.js';

const messages = {
    INVALID_REQUEST: 'Invalid update request.',
    INVALID_INVOICE_DRAFT: 'Invalid invoice draft.',
    REFERENCE_NOT_SUPPORTED: 'Linked references are not supported.',
    BUSINESS_ACCESS_DENIED: 'Business access denied.',
    INVOICE_NOT_EDITABLE: 'Invoice is not editable.',
    INVOICE_REVISION_CONFLICT: 'Invoice changed. Reload before saving.',
    INTERNAL: 'Unable to prepare invoice update.'
};

export class InvoiceDraftUpdateCommandError extends Error {
    constructor(code) {
        super(messages[code]);
        this.name = 'InvoiceDraftUpdateCommandError';
        this.code = code;
    }
}

const fail = code => { throw new InvoiceDraftUpdateCommandError(code); };
const requireStored = condition => { if (!condition) fail('INTERNAL'); };
const positiveRevision = value => Number.isSafeInteger(value) && value >= 1;
const identity = value => typeof value === 'string' && value.isWellFormed()
    && value.length > 0 && [...value].length <= 128 && value.trim() === value
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const businessRoute = value => identity(value) && !value.includes('/')
    && !['.', '..'].includes(value) && !/^__.*__$/u.test(value);

const requestFields = ['authContext', 'businessContext', 'businessId', 'invoiceId', 'storedInvoice', 'expectedRevision', 'input'];
const commonFields = ['schemaVersion', 'businessId', 'ownerId', 'revision', 'lifecycleStatus'];
const storedFields = [...commonFields, 'paymentStatus', 'customer', 'currency', 'issueDate', 'dueDate', 'lineItems',
    'subtotalMinor', 'discountMinor', 'taxMinor', 'totalMinor', 'amountPaidMinor', 'balanceDueMinor',
    'createdBy', 'updatedBy', 'createdAt', 'updatedAt'];
const customerFields = ['id', 'name', 'email', 'address'];
const lineInputs = ['id', 'description', 'quantity', 'unitPriceMinor', 'discountMinor', 'taxCode', 'taxRateBps', 'catalogItemId'];
const lineFields = [...lineInputs, 'subtotalMinor', 'taxMinor', 'totalMinor'];
const totalFields = ['subtotalMinor', 'discountMinor', 'taxMinor', 'totalMinor'];

// Trusted snapshots are plain data, not proxies or SDK objects. Read own data
// descriptors so malformed accessor fields never run. No JSON coercion/hooks.
function record(value, fields, { exact = true, code = 'INTERNAL', optional = [] } = {}) {
    if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
    const keys = Reflect.ownKeys(value);
    if (exact && keys.some(key => !fields.includes(key))) fail(code);
    const result = {};
    for (const key of fields) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor && optional.includes(key)) { result[key] = undefined; continue; }
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(code);
        result[key] = descriptor.value;
    }
    return result;
}

function timestamp(value) {
    const result = record(value, ['seconds', 'nanoseconds']);
    // Plain evidence uses the Firestore timestamp calendar range (years 1–9999).
    requireStored(Number.isSafeInteger(result.seconds) && result.seconds >= -62135596800 && result.seconds <= 253402300799);
    requireStored(Number.isInteger(result.nanoseconds) && result.nanoseconds >= 0 && result.nanoseconds <= 999999999);
    return result;
}

function storedDraft(value, businessId, ownerId) {
    const common = record(value, commonFields, { exact: false });
    requireStored(common.schemaVersion === 2 && common.businessId === businessId && common.ownerId === ownerId);
    requireStored(positiveRevision(common.revision));
    requireStored(typeof common.lifecycleStatus === 'string' && common.lifecycleStatus.length <= 64
        && /^[a-z][a-z0-9_]*$/.test(common.lifecycleStatus) && !/[^a-z0-9_]/.test(common.lifecycleStatus));
    if (common.lifecycleStatus !== 'draft') fail('INVOICE_NOT_EDITABLE');

    const stored = record(value, storedFields);
    const customer = record(stored.customer, customerFields);
    const createdAt = timestamp(stored.createdAt), updatedAt = timestamp(stored.updatedAt);
    requireStored(identity(stored.createdBy) && identity(stored.updatedBy));
    requireStored(updatedAt.seconds > createdAt.seconds
        || (updatedAt.seconds === createdAt.seconds && updatedAt.nanoseconds >= createdAt.nanoseconds));
    requireStored(Array.isArray(stored.lineItems) && stored.lineItems.length <= 100
        && Reflect.ownKeys(stored.lineItems).length === stored.lineItems.length + 1);
    const lines = [];
    for (let index = 0; index < stored.lineItems.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(stored.lineItems, String(index));
        requireStored(descriptor && Object.hasOwn(descriptor, 'value'));
        lines.push(record(descriptor.value, lineFields));
    }
    requireStored(customer.id === null && lines.every(line => line.catalogItemId === null));
    let normalized;
    try {
        normalized = validateInvoiceDraft({
            customerId: customer.id, customerName: customer.name, customerEmail: customer.email, customerAddress: customer.address,
            currency: stored.currency, issueDate: stored.issueDate, dueDate: stored.dueDate,
            lineItems: lines.map(line => Object.fromEntries(lineInputs.map(key => [key, line[key]])))
        });
    } catch (error) {
        if (error instanceof InvoiceDraftValidationError) fail('INTERNAL');
        throw error;
    }
    const expectedCustomer = { id: normalized.customerId, name: normalized.customerName, email: normalized.customerEmail, address: normalized.customerAddress };
    requireStored(customerFields.every(key => customer[key] === expectedCustomer[key]));
    requireStored(['currency', 'issueDate', 'dueDate'].every(key => stored[key] === normalized[key]));
    requireStored(lines.every((line, index) => lineFields.every(key => line[key] === normalized.lineItems[index][key])));
    requireStored(totalFields.every(key => stored[key] === normalized.totals[key]));
    requireStored(stored.paymentStatus === 'not_due' && stored.amountPaidMinor === 0 && stored.balanceDueMinor === normalized.totals.totalMinor);
    return { revision: stored.revision, createdBy: stored.createdBy, createdAt };
}

// Keep only approved validation details; unknown field names may contain PII.
const safePath = /^(customerId|customerName|customerEmail|customerAddress|currency|issueDate|dueDate|lineItems(?:\[\d{1,3}\](?:\.(?:id|description|quantity|unitPriceMinor|discountMinor|taxRateBps|taxCode|catalogItemId))?)?)$/;

/**
 * Pure preparation only. Contexts and stored snapshot MUST come from a trusted
 * adapter; this function cannot prove provenance, membership activity or atomicity.
 * Routes/precondition -> Stage 9B auth + Stage 8B candidate -> route binding ->
 * references -> stored invariants/eligibility -> revision comparison/overflow.
 * No clock, persistence, timestamp generation or issuance validation.
 */
export function authorizeAndPrepareInvoiceDraftUpdate(options) {
    const { authContext, businessContext, businessId, invoiceId, storedInvoice, expectedRevision, input } =
        record(options, requestFields, { code: 'INVALID_REQUEST', optional: ['authContext', 'businessContext'] });
    if (!businessRoute(businessId) || !identity(invoiceId) || /[^A-Za-z0-9_-]/.test(invoiceId)
        || /^__.*__$/.test(invoiceId) || !positiveRevision(expectedRevision)) fail('INVALID_REQUEST');
    let command;
    try {
        command = authorizeAndPrepareInvoiceDraftCommand({ authContext, businessContext, input });
    } catch (error) {
        if (!(error instanceof InvoiceDraftValidationError)) throw error; // Preserve Stage 9B authorization errors unchanged.
        const result = new InvoiceDraftUpdateCommandError('INVALID_INVOICE_DRAFT');
        result.domainCode = error.code;
        if (typeof error.path === 'string' && error.path.trim() === error.path && safePath.test(error.path)) result.path = error.path;
        throw result;
    }
    if (command.businessId !== businessId) fail('BUSINESS_ACCESS_DENIED');
    if (command.draft.customerId !== null || command.draft.lineItems.some(line => line.catalogItemId !== null)) fail('REFERENCE_NOT_SUPPORTED');
    const stored = storedDraft(storedInvoice, businessId, command.ownerId);
    if (stored.revision !== expectedRevision) fail('INVOICE_REVISION_CONFLICT');
    if (stored.revision === Number.MAX_SAFE_INTEGER) fail('INTERNAL');
    return {
        businessId, invoiceId, ownerId: command.ownerId, actorUid: command.actorUid,
        expectedRevision, previousRevision: stored.revision, nextRevision: stored.revision + 1,
        draft: command.draft,
        preserved: { createdBy: stored.createdBy, createdAt: stored.createdAt }
    };
}

// Shared trusted-state validation; export only, with no change to update semantics.
export { storedDraft as validateStoredInvoiceDraft };
