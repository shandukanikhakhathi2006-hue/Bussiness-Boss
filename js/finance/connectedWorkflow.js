// Canonical connected-workflow calculations. These helpers are pure and do
// not read or write Firestore; future server commands supply trusted values.

export class ConnectedWorkflowError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ConnectedWorkflowError';
        this.code = code;
    }
}

const fail = (code, message) => { throw new ConnectedWorkflowError(code, message); };
const plainObject = value => value !== null && typeof value === 'object'
    && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const validCalendarDate = value => {
    if (!dateOnly(value)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
};

const nonNegativeMinor = (value, code) => {
    if (!Number.isSafeInteger(value) || value < 0) fail(code, 'Amount must be a non-negative safe integer in minor units.');
    return value;
};

const positiveMinor = (value, code) => {
    const amount = nonNegativeMinor(value, code);
    if (amount === 0) fail(code, 'Amount must be greater than zero.');
    return amount;
};

/**
 * Canonical customer IDs are opaque Firestore document IDs. Display names are
 * intentionally absent: names are snapshots, never relationship authority.
 */
export const requireCanonicalCustomerId = value => {
    if (typeof value !== 'string' || !value.trim()) fail('CUSTOMER_ID_REQUIRED', 'A customer ID is required.');
    if (value.trim() !== value || value.length > 128 || value.includes('/') || ['.', '..'].includes(value)
        || /^__.*__$/.test(value) || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
        fail('INVALID_CUSTOMER_ID', 'Customer ID is not a valid document identifier.');
    }
    return value;
};

/**
 * Projects a trusted invoice total and paid amount into its derived payment
 * fields. Issued invoices are positive-value documents, so zero is rejected.
 */
export const deriveOutstandingBalance = input => {
    if (!plainObject(input)) fail('INVALID_PAYMENT_PROJECTION', 'Payment projection must be an object.');
    const { totalMinor, amountPaidMinor } = input;
    const total = positiveMinor(totalMinor, 'INVALID_INVOICE_TOTAL');
    const paid = nonNegativeMinor(amountPaidMinor, 'INVALID_AMOUNT_PAID');
    if (paid > total) fail('OVERPAYMENT', 'Received payments cannot exceed the invoice total.');
    const balanceDueMinor = total - paid;
    return Object.freeze({
        amountPaidMinor: paid,
        balanceDueMinor,
        paymentState: paid === 0 ? 'unpaid' : balanceDueMinor === 0 ? 'paid' : 'partial'
    });
};

/**
 * Sums only already-authoritative, effective received-payment amounts. The
 * caller is responsible for excluding pending, voided, or reversed records.
 */
export const deriveInvoicePaymentState = input => {
    if (!plainObject(input)) fail('INVALID_PAYMENT_PROJECTION', 'Payment projection must be an object.');
    const { totalMinor, receivedPaymentAmountsMinor = [] } = input;
    if (!Array.isArray(receivedPaymentAmountsMinor)) fail('INVALID_PAYMENT_AMOUNTS', 'Received payment amounts must be an array.');
    const amountPaidMinor = receivedPaymentAmountsMinor.reduce((sum, value) => {
        const amount = positiveMinor(value, 'INVALID_PAYMENT_AMOUNT');
        if (sum > Number.MAX_SAFE_INTEGER - amount) fail('UNSAFE_FINANCIAL_VALUE', 'Payment total exceeds the safe-integer limit.');
        return sum + amount;
    }, 0);
    return deriveOutstandingBalance({ totalMinor, amountPaidMinor });
};

/**
 * Overdue is derived in the business timezone from a trusted YYYY-MM-DD
 * as-of date. It is never a writable invoice status.
 */
export const isInvoiceOverdue = input => {
    if (!plainObject(input)) fail('INVALID_INVOICE_PROJECTION', 'Invoice projection must be an object.');
    const { lifecycleStatus, balanceDueMinor, dueDate, asOfDate } = input;
    if (!['draft', 'issued', 'void'].includes(lifecycleStatus)) {
        fail('INVALID_INVOICE_LIFECYCLE', 'Invoice lifecycle must be draft, issued, or void.');
    }
    nonNegativeMinor(balanceDueMinor, 'INVALID_BALANCE_DUE');
    if (dueDate !== null && dueDate !== undefined && !validCalendarDate(dueDate)) {
        fail('INVALID_DUE_DATE', 'Due date must be YYYY-MM-DD or null.');
    }
    if (!validCalendarDate(asOfDate)) fail('INVALID_AS_OF_DATE', 'As-of date must be a valid YYYY-MM-DD calendar date.');
    return lifecycleStatus === 'issued' && balanceDueMinor > 0 && typeof dueDate === 'string' && dueDate < asOfDate;
};
