/**
 * Isolated Invoice v2 arithmetic. No production integration or tax policy.
 * All four line inputs are required. Money is integer minor units; quantities
 * are positive decimal strings with up to three fractional digits.
 * Scaled products, rounded components and invoice sums must all fit within
 * Number.MAX_SAFE_INTEGER. BigInt is internal only; results are safe Numbers.
 */
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const QUANTITY_SCALE = 1000n;
const BASIS_POINT_SCALE = 10000n;

export class InvoiceCalculationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'InvoiceCalculationError';
        this.code = code;
    }
}

const fail = (code, message) => {
    throw new InvoiceCalculationError(code, message);
};

const validateInteger = (value, code, field) => {
    if (!Number.isSafeInteger(value) || value < 0) {
        fail(code, `${field} must be a non-negative safe integer Number.`);
    }
    return BigInt(value);
};

const checkedMultiply = (left, right) => {
    if (right !== 0n && left > MAX_SAFE / right) {
        fail('UNSAFE_FINANCIAL_VALUE', 'Scaled multiplication exceeds the safe-integer limit.');
    }
    return left * right;
};

const checkedAdd = (left, right) => {
    if (left > MAX_SAFE - right) {
        fail('UNSAFE_FINANCIAL_VALUE', 'Addition exceeds the safe-integer limit.');
    }
    return left + right;
};

// Exact non-negative rational rounding. Avoid numerator + denominator / 2,
// which could overflow at the boundary even when the rounded result is safe.
const roundHalfUp = (numerator, denominator) => {
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    const half = (denominator + 1n) / 2n;
    return checkedAdd(quotient, remainder >= half ? 1n : 0n);
};

/** Accepts canonical unsigned decimal syntax, e.g. "1", "1.500", "0.125". */
export const parseQuantityThousandths = (quantity) => {
    if (typeof quantity !== 'string' || quantity.trim() !== quantity || !/^(0|[1-9]\d*)(\.\d{1,3})?$/.test(quantity)) {
        fail('INVALID_QUANTITY', 'Quantity must be an unsigned decimal string with at most three decimal places.');
    }
    const [whole, fraction = ''] = quantity.split('.');
    // Bound string size before BigInt parsing; a safe scaled quantity has at
    // most 13 whole-number digits. Precision is never silently discarded.
    if (whole.length > 13) {
        fail('UNSAFE_FINANCIAL_VALUE', 'Quantity thousandths exceed the safe-integer limit.');
    }
    const scaled = checkedAdd(checkedMultiply(BigInt(whole), QUANTITY_SCALE), BigInt(fraction.padEnd(3, '0')));
    if (scaled === 0n) fail('INVALID_QUANTITY', 'Quantity must be positive.');
    return Number(scaled);
};

/** Returns rounded line components; never mutates or trusts supplied totals. */
export const calculateLineItem = (line) => {
    if (line === null || typeof line !== 'object' || Array.isArray(line)) {
        fail('INVALID_LINE_ITEM', 'A line item must be an object.');
    }
    const quantity = BigInt(parseQuantityThousandths(line.quantity));
    const price = validateInteger(line.unitPriceMinor, 'INVALID_UNIT_PRICE', 'unitPriceMinor');
    const discount = validateInteger(line.discountMinor, 'INVALID_DISCOUNT', 'discountMinor');
    const rate = validateInteger(line.taxRateBps, 'INVALID_TAX_RATE', 'taxRateBps');
    const subtotal = roundHalfUp(checkedMultiply(quantity, price), QUANTITY_SCALE);
    if (discount > subtotal) {
        fail('DISCOUNT_EXCEEDS_SUBTOTAL', 'discountMinor cannot exceed the rounded line subtotal.');
    }
    const taxable = subtotal - discount;
    const tax = roundHalfUp(checkedMultiply(taxable, rate), BASIS_POINT_SCALE);
    const total = checkedAdd(taxable, tax);
    return {
        subtotalMinor: Number(subtotal),
        discountMinor: Number(discount),
        taxMinor: Number(tax),
        totalMinor: Number(total)
    };
};

/** Sums individually rounded lines. Empty input returns four zero components. */
export const calculateInvoiceTotals = (lineItems) => {
    if (!Array.isArray(lineItems)) fail('INVALID_LINE_ITEMS', 'lineItems must be an array.');
    const totals = { subtotalMinor: 0n, discountMinor: 0n, taxMinor: 0n, totalMinor: 0n };
    for (const line of lineItems) {
        const result = calculateLineItem(line);
        for (const field of Object.keys(totals)) {
            totals[field] = checkedAdd(totals[field], BigInt(result[field]));
        }
    }
    return Object.fromEntries(Object.entries(totals).map(([field, value]) => [field, Number(value)]));
};
