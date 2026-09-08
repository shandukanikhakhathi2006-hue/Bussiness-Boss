import test from 'node:test';
import assert from 'node:assert/strict';
import { InvoiceCalculationError, parseQuantityThousandths, calculateLineItem, calculateInvoiceTotals } from '../js/finance/invoiceCalculations.js';

const line = (overrides = {}) => ({ quantity: '1', unitPriceMinor: 1000, discountMinor: 0, taxRateBps: 0, ...overrides });
const amounts = (subtotalMinor, discountMinor, taxMinor, totalMinor) => ({ subtotalMinor, discountMinor, taxMinor, totalMinor });
const errorCode = (fn, code) => assert.throws(fn, error => error instanceof InvoiceCalculationError && error.code === code);

for (const [quantity, expected] of [['1', 1000], ['1.5', 1500], ['1.500', 1500], ['0.125', 125], ['0.001', 1], ['9007199254740.991', Number.MAX_SAFE_INTEGER]]) {
    test(`quantity ${quantity} → ${expected}`, () => assert.equal(parseQuantityThousandths(quantity), expected));
}
for (const quantity of ['', '0', '0.000', '-1', '1.2345', 'abc', '1e3', 'Infinity', 'NaN', ' 1', '1 ', '1\n', '1\r', '1\u2028', '+1', '.5', '1.', '01', 1, null, undefined]) {
    test(`invalid quantity ${String(quantity)} (${typeof quantity})`, () => errorCode(() => parseQuantityThousandths(quantity), 'INVALID_QUANTITY'));
}
for (const quantity of ['9007199254740.992', '999999999999999999999999999']) {
    test(`unsafe quantity ${quantity}`, () => errorCode(() => parseQuantityThousandths(quantity), 'UNSAFE_FINANCIAL_VALUE'));
}

for (const [name, input, expected] of [
    ['basic line and zero tax', line(), amounts(1000, 0, 0, 1000)],
    ['fractional quantity', line({ quantity: '1.5' }), amounts(1500, 0, 0, 1500)],
    ['flat discount', line({ discountMinor: 250 }), amounts(1000, 250, 0, 750)],
    ['basis point tax', line({ taxRateBps: 1000 }), amounts(1000, 0, 100, 1100)],
    ['approved architecture example', line({ quantity: '1.500', discountMinor: 100, taxRateBps: 1000 }), amounts(1500, 100, 140, 1540)],
    ['subtotal below half', line({ quantity: '0.499', unitPriceMinor: 1 }), amounts(0, 0, 0, 0)],
    ['subtotal exact half', line({ quantity: '0.500', unitPriceMinor: 1 }), amounts(1, 0, 0, 1)],
    ['subtotal above half', line({ quantity: '0.501', unitPriceMinor: 1 }), amounts(1, 0, 0, 1)],
    ['tax below half', line({ unitPriceMinor: 1, taxRateBps: 4999 }), amounts(1, 0, 0, 1)],
    ['tax exact half', line({ unitPriceMinor: 1, taxRateBps: 5000 }), amounts(1, 0, 1, 2)],
    ['tax above half', line({ unitPriceMinor: 1, taxRateBps: 5001 }), amounts(1, 0, 1, 2)],
    ['zero-price line', line({ unitPriceMinor: 0, taxRateBps: 1500 }), amounts(0, 0, 0, 0)],
    ['full discount', line({ discountMinor: 1000, taxRateBps: 1500 }), amounts(1000, 1000, 0, 0)],
    ['discount uses rounded subtotal', line({ quantity: '0.500', unitPriceMinor: 1, discountMinor: 1 }), amounts(1, 1, 0, 0)],
    ['subtotal and then tax rounding', line({ quantity: '0.5', unitPriceMinor: 3, taxRateBps: 2500 }), amounts(2, 0, 1, 3)],
    ['tax has no hardcoded policy ceiling', line({ unitPriceMinor: 1, taxRateBps: 20000 }), amounts(1, 0, 2, 3)]
]) test(name, () => assert.deepEqual(calculateLineItem(input), expected));

test('discount exceeds rounded subtotal', () => errorCode(() => calculateLineItem(line({ discountMinor: 1001 })), 'DISCOUNT_EXCEEDS_SUBTOTAL'));
for (const [field, code] of [['unitPriceMinor', 'INVALID_UNIT_PRICE'], ['discountMinor', 'INVALID_DISCOUNT'], ['taxRateBps', 'INVALID_TAX_RATE']]) {
    for (const value of [-1, 0.1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '100', 1n, null, undefined]) {
        test(`${field} rejects ${String(value)} (${typeof value})`, () => errorCode(() => calculateLineItem(line({ [field]: value })), code));
    }
}
for (const value of [null, undefined, [], 'line', 3]) {
    test(`invalid line object ${String(value)}`, () => errorCode(() => calculateLineItem(value), 'INVALID_LINE_ITEM'));
}
for (const value of [null, undefined, {}, 'lines', 3]) {
    test(`invalid invoice array ${String(value)}`, () => errorCode(() => calculateInvoiceTotals(value), 'INVALID_LINE_ITEMS'));
}

test('subtotal scaled product overflow', () => errorCode(() => calculateLineItem(line({ unitPriceMinor: Number.MAX_SAFE_INTEGER })), 'UNSAFE_FINANCIAL_VALUE'));
test('tax scaled product overflow', () => errorCode(() => calculateLineItem(line({ unitPriceMinor: 2, taxRateBps: Number.MAX_SAFE_INTEGER })), 'UNSAFE_FINANCIAL_VALUE'));
test('safe scaled numerator near limit rounds without adding half to numerator', () => {
    assert.deepEqual(calculateLineItem(line({ quantity: '9007199254740.991', unitPriceMinor: 1 })), amounts(9007199254741, 0, 0, 9007199254741));
});
test('safe tax numerator near limit', () => {
    assert.deepEqual(calculateLineItem(line({ unitPriceMinor: 1, taxRateBps: Number.MAX_SAFE_INTEGER })), amounts(1, 0, 900719925474, 900719925475));
});
test('maximum rate with zero taxable amount', () => assert.deepEqual(calculateLineItem(line({ discountMinor: 1000, taxRateBps: Number.MAX_SAFE_INTEGER })), amounts(1000, 1000, 0, 0)));

test('invoice sums line rounding rather than rounding the grand subtotal', () => {
    assert.deepEqual(calculateInvoiceTotals([line({ quantity: '0.5', unitPriceMinor: 1 }), line({ quantity: '0.5', unitPriceMinor: 1 })]), amounts(2, 0, 0, 2));
});
test('invoice sums line taxes rather than applying tax to combined base', () => {
    assert.deepEqual(calculateInvoiceTotals([line({ unitPriceMinor: 1, taxRateBps: 5000 }), line({ unitPriceMinor: 1, taxRateBps: 5000 })]), amounts(2, 0, 2, 4));
});
test('mixed invoice component totals', () => {
    assert.deepEqual(calculateInvoiceTotals([line({ quantity: '1.5', discountMinor: 100, taxRateBps: 1000 }), line({ unitPriceMinor: 200, discountMinor: 50, taxRateBps: 2000 })]), amounts(1700, 150, 170, 1720));
});
test('empty invoice', () => assert.deepEqual(calculateInvoiceTotals([]), amounts(0, 0, 0, 0)));
test('invalid invoice line is rejected, not skipped', () => errorCode(() => calculateInvoiceTotals([line(), line({ quantity: '0' })]), 'INVALID_QUANTITY'));
test('sparse invoice array is rejected', () => errorCode(() => calculateInvoiceTotals(new Array(1)), 'INVALID_LINE_ITEM'));
test('invoice subtotal sum overflow', () => errorCode(() => calculateInvoiceTotals(Array.from({ length: 1001 }, () => line({ unitPriceMinor: 9007199254740 }))), 'UNSAFE_FINANCIAL_VALUE'));
test('invoice total sum overflow while individual component sums are safe', () => errorCode(() => calculateInvoiceTotals(Array.from({ length: 910 }, () => line({ unitPriceMinor: 9007199254740, taxRateBps: 1000 }))), 'UNSAFE_FINANCIAL_VALUE'));
test('invoice totals can reach the exact safe-integer limit', () => {
    const lines = Array.from({ length: 1000 }, () => line({ unitPriceMinor: 9007199254740 }));
    lines.push(line({ unitPriceMinor: 991 }));
    assert.deepEqual(calculateInvoiceTotals(lines), amounts(Number.MAX_SAFE_INTEGER, 0, 0, Number.MAX_SAFE_INTEGER));
    lines.push(line({ unitPriceMinor: 1 }));
    errorCode(() => calculateInvoiceTotals(lines), 'UNSAFE_FINANCIAL_VALUE');
});

test('inputs remain frozen and repeated calls are deterministic', () => {
    const input = Object.freeze(line({ quantity: '1.500', discountMinor: 100, taxRateBps: 1000 }));
    const inputs = Object.freeze([input]);
    const before = JSON.stringify(inputs);
    assert.deepEqual(calculateInvoiceTotals(inputs), calculateInvoiceTotals(inputs));
    const result = calculateLineItem(input);
    result.totalMinor = -1;
    assert.equal(calculateLineItem(input).totalMinor, 1540);
    assert.equal(JSON.stringify(inputs), before);
});
test('untrusted precomputed totals are ignored', () => assert.deepEqual(calculateLineItem({ ...line(), subtotalMinor: 999, totalMinor: 999 }), amounts(1000, 0, 0, 1000)));
