import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ConnectedWorkflowError,
    deriveInvoicePaymentState,
    deriveOutstandingBalance,
    isInvoiceOverdue,
    requireCanonicalCustomerId
} from '../js/finance/connectedWorkflow.js';

const error = (operation, code) => assert.throws(operation, candidate =>
    candidate instanceof ConnectedWorkflowError && candidate.code === code);

test('unpaid, partial, and fully paid invoices derive exact minor-unit balances', () => {
    assert.deepEqual(deriveInvoicePaymentState({ totalMinor: 1540 }), {
        amountPaidMinor: 0, balanceDueMinor: 1540, paymentState: 'unpaid'
    });
    assert.deepEqual(deriveInvoicePaymentState({ totalMinor: 1540, receivedPaymentAmountsMinor: [540] }), {
        amountPaidMinor: 540, balanceDueMinor: 1000, paymentState: 'partial'
    });
    assert.deepEqual(deriveInvoicePaymentState({ totalMinor: 1540, receivedPaymentAmountsMinor: [1000, 540] }), {
        amountPaidMinor: 1540, balanceDueMinor: 0, paymentState: 'paid'
    });
});

test('payment projections reject floats, non-effective zero payments, and overpayments', () => {
    error(() => deriveOutstandingBalance(null), 'INVALID_PAYMENT_PROJECTION');
    error(() => deriveInvoicePaymentState(null), 'INVALID_PAYMENT_PROJECTION');
    error(() => deriveOutstandingBalance({ totalMinor: 1540.5, amountPaidMinor: 0 }), 'INVALID_INVOICE_TOTAL');
    error(() => deriveInvoicePaymentState({ totalMinor: 1540, receivedPaymentAmountsMinor: [0] }), 'INVALID_PAYMENT_AMOUNT');
    error(() => deriveInvoicePaymentState({ totalMinor: 1540, receivedPaymentAmountsMinor: [1541] }), 'OVERPAYMENT');
    error(() => deriveOutstandingBalance({ totalMinor: 1540, amountPaidMinor: 1541 }), 'OVERPAYMENT');
});

test('only issued invoices with outstanding balance and a past due date are overdue', () => {
    assert.equal(isInvoiceOverdue({ lifecycleStatus: 'issued', balanceDueMinor: 10, dueDate: '2026-09-30', asOfDate: '2026-10-01' }), true);
    assert.equal(isInvoiceOverdue({ lifecycleStatus: 'issued', balanceDueMinor: 0, dueDate: '2026-09-30', asOfDate: '2026-10-01' }), false);
    assert.equal(isInvoiceOverdue({ lifecycleStatus: 'issued', balanceDueMinor: 10, dueDate: '2026-10-01', asOfDate: '2026-10-01' }), false);
    assert.equal(isInvoiceOverdue({ lifecycleStatus: 'issued', balanceDueMinor: 10, dueDate: '2026-10-31', asOfDate: '2026-10-01' }), false);
    assert.equal(isInvoiceOverdue({ lifecycleStatus: 'draft', balanceDueMinor: 10, dueDate: '2026-09-30', asOfDate: '2026-10-01' }), false);
    assert.equal(isInvoiceOverdue({ lifecycleStatus: 'void', balanceDueMinor: 10, dueDate: '2026-09-30', asOfDate: '2026-10-01' }), false);
});

test('customer identity is required and duplicate display names remain distinct by ID', () => {
    assert.equal(requireCanonicalCustomerId('customer-a'), 'customer-a');
    assert.equal(requireCanonicalCustomerId('customer-b'), 'customer-b');
    assert.notEqual(requireCanonicalCustomerId('customer-a'), requireCanonicalCustomerId('customer-b'));
    error(() => requireCanonicalCustomerId(''), 'CUSTOMER_ID_REQUIRED');
    error(() => requireCanonicalCustomerId(' customer-a '), 'INVALID_CUSTOMER_ID');
    error(() => requireCanonicalCustomerId('customers/customer-a'), 'INVALID_CUSTOMER_ID');
});

test('overdue calculation requires valid business-calendar dates', () => {
    error(() => isInvoiceOverdue(null), 'INVALID_INVOICE_PROJECTION');
    error(() => isInvoiceOverdue({ lifecycleStatus: 'issued', balanceDueMinor: 10, dueDate: '2026-02-30', asOfDate: '2026-10-01' }), 'INVALID_DUE_DATE');
    error(() => isInvoiceOverdue({ lifecycleStatus: 'issued', balanceDueMinor: 10, dueDate: null, asOfDate: '2026-02-30' }), 'INVALID_AS_OF_DATE');
});
