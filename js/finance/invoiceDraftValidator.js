import { calculateLineItem, calculateInvoiceTotals, InvoiceCalculationError } from './invoiceCalculations.js';

// Preview/input validation only. Totals are not authoritative persisted values.
const DRAFT_FIELDS = ['customerId', 'customerName', 'customerEmail', 'customerAddress', 'currency', 'issueDate', 'dueDate', 'lineItems'];
const LINE_FIELDS = ['id', 'description', 'quantity', 'unitPriceMinor', 'discountMinor', 'taxRateBps', 'taxCode', 'catalogItemId'];

export class InvoiceDraftValidationError extends Error {
    constructor(code, message, path) {
        super(message);
        this.name = 'InvoiceDraftValidationError';
        this.code = code;
        this.path = path;
    }
}

const fail = (code, path, message) => { throw new InvoiceDraftValidationError(code, message, path); };

// Accept plain data objects only. Inspect descriptors so accessors never run.
const readObject = (input, allowed, code, unknownCode, path) => {
    if (input === null || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
        fail(code, path, 'Expected a plain data object.');
    }
    const output = Object.create(null);
    for (const key of Reflect.ownKeys(input)) {
        const fieldPath = `${path}.${String(key)}`;
        if (typeof key !== 'string' || !allowed.includes(key)) fail(unknownCode, fieldPath, 'Unexpected input field.');
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!Object.hasOwn(descriptor, 'value')) fail(code, fieldPath, 'Accessor properties are not accepted.');
        output[key] = descriptor.value;
    }
    return output;
};

const text = (value, code, path, limit, { nullable = false, empty = false, multiline = false } = {}) => {
    if (nullable && value === null) return null;
    if (typeof value !== 'string') fail(code, path, 'Expected a string.');
    const controls = multiline ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/ : /[\u0000-\u001f\u007f-\u009f]/;
    if (controls.test(value)) fail(code, path, 'Control characters are not accepted.');
    const normalized = (multiline ? value.replace(/\r\n?/g, '\n') : value).trim();
    if ((!empty && !normalized) || Array.from(normalized).length > limit) fail(code, path, 'Text is empty or exceeds its length limit.');
    return normalized;
};

const dateOnly = (value, code, path) => {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(code, path, 'Expected YYYY-MM-DD or null.');
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail(code, path, 'Invalid Gregorian calendar date.');
    return value;
};

const arithmetic = (operation, path) => {
    try { return operation(); } catch (error) {
        if (!(error instanceof InvoiceCalculationError)) throw error;
        const wrapped = new InvoiceDraftValidationError(error.code, error.message, path);
        wrapped.cause = error;
        throw wrapped;
    }
};

/**
 * Requires currency and lineItems. Omitted customer/date fields default to
 * null, except customerName defaults to ''. Explicit undefined is invalid.
 * Returns fresh objects; computed preview fields are deliberately not inputs.
 */
export const validateInvoiceDraft = (input) => {
    const draft = readObject(input, DRAFT_FIELDS, 'INVALID_DRAFT', 'UNKNOWN_DRAFT_FIELD', 'draft');
    const valueOr = (field, fallback) => Object.hasOwn(draft, field) ? draft[field] : fallback;
    const customerId = text(valueOr('customerId', null), 'INVALID_CUSTOMER_ID', 'customerId', 128, { nullable: true });
    const customerName = text(valueOr('customerName', ''), 'INVALID_CUSTOMER_NAME', 'customerName', 200, { empty: true });
    const customerEmail = text(valueOr('customerEmail', null), 'INVALID_CUSTOMER_EMAIL', 'customerEmail', 254, { nullable: true });
    // Intentionally modest ASCII email subset; preserves case and plus tags.
    if (customerEmail !== null && !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(customerEmail)) {
        fail('INVALID_CUSTOMER_EMAIL', 'customerEmail', 'Email structure is invalid.');
    }
    const customerAddress = text(valueOr('customerAddress', null), 'INVALID_CUSTOMER_ADDRESS', 'customerAddress', 1000, { nullable: true, multiline: true });
    if (draft.currency !== 'ZAR') fail('INVALID_CURRENCY', 'currency', 'Currency must be exactly ZAR.');
    const issueDate = dateOnly(valueOr('issueDate', null), 'INVALID_ISSUE_DATE', 'issueDate');
    const dueDate = dateOnly(valueOr('dueDate', null), 'INVALID_DUE_DATE', 'dueDate');
    if (issueDate !== null && dueDate !== null && dueDate < issueDate) fail('DUE_DATE_BEFORE_ISSUE_DATE', 'dueDate', 'Due date precedes issue date.');
    if (!Array.isArray(draft.lineItems)) fail('INVALID_LINE_ITEMS', 'lineItems', 'Expected an array.');
    if (draft.lineItems.length > 100) fail('TOO_MANY_LINE_ITEMS', 'lineItems', 'At most 100 lines are accepted.');
    const ids = new Set();
    const lines = [];
    for (let index = 0; index < draft.lineItems.length; index += 1) {
        const path = `lineItems[${index}]`;
        const descriptor = Object.getOwnPropertyDescriptor(draft.lineItems, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('INVALID_LINE_ITEMS', path, 'Sparse arrays and accessor entries are not accepted.');
        const source = readObject(descriptor.value, LINE_FIELDS, 'INVALID_LINE_ITEM', 'UNKNOWN_LINE_ITEM_FIELD', path);
        const id = text(source.id, 'INVALID_LINE_ID', `${path}.id`, 128);
        if (ids.has(id)) fail('DUPLICATE_LINE_ID', `${path}.id`, 'Line IDs must be unique after trimming.');
        ids.add(id);
        const normalized = {
            id,
            description: text(source.description, 'INVALID_DESCRIPTION', `${path}.description`, 500),
            quantity: source.quantity,
            unitPriceMinor: source.unitPriceMinor,
            discountMinor: source.discountMinor,
            taxRateBps: source.taxRateBps,
            taxCode: text(source.taxCode, 'INVALID_TAX_CODE', `${path}.taxCode`, 64),
            catalogItemId: text(Object.hasOwn(source, 'catalogItemId') ? source.catalogItemId : null, 'INVALID_CATALOG_ITEM_ID', `${path}.catalogItemId`, 128, { nullable: true })
        };
        const calculated = arithmetic(() => calculateLineItem(normalized), path);
        lines.push({ ...normalized, ...calculated });
    }
    const totals = arithmetic(() => calculateInvoiceTotals(lines), 'lineItems');
    return { customerId, customerName, customerEmail, customerAddress, currency: 'ZAR', issueDate, dueDate, lineItems: lines, totals };
};
