import test from 'node:test';
import assert from 'node:assert/strict';
import { AppointmentValidationError, normalizeAppointmentInput } from '../js/features/appointmentContract.js';

const valid = (extra = {}) => ({
    customerName: 'Alex Customer', customerId: 'customer-1', date: '2026-09-25', time: '08:00',
    service: 'Consulting', staff: 'Taylor', status: 'pending', ...extra
});
const invalid = (input, path) => assert.throws(() => normalizeAppointmentInput(input), error =>
    error instanceof AppointmentValidationError && error.code === 'INVALID_APPOINTMENT' && error.path === path);

test('normalizes a complete appointment into the exact editable projection', () => {
    assert.deepEqual(normalizeAppointmentInput(valid()), valid());
});
test('minimal input defaults optional values and status', () => {
    assert.deepEqual(normalizeAppointmentInput({ customerName: 'Alex', date: '2026-09-25', time: '08:00' }), {
        customerName: 'Alex', customerId: '', date: '2026-09-25', time: '08:00', service: '', staff: '', status: 'pending'
    });
});
for (const value of [null, [], 'appointment', 1, new Date()]) test(`rejects non-plain input ${String(value)}`, () => invalid(value, 'input'));
for (const field of ['ownerId', 'businessId', 'createdAt', 'updatedAt', 'completedAt', 'bookingId', 'revision', 'paymentStatus', 'invoiceNumber']) {
    test(`rejects protected or unknown ${field}`, () => invalid({ ...valid(), [field]: 'injected' }, field));
}
test('rejects an accessor without executing it', () => {
    const input = valid();
    Object.defineProperty(input, 'ownerId', { get() { throw Error('must not run'); } });
    invalid(input, 'ownerId');
});
for (const [source, normalized] of [['Alex Customer', 'Alex Customer'], ['  Alex Customer  ', 'Alex Customer']]) {
    test(`normalizes customer name ${JSON.stringify(source)}`, () => assert.equal(normalizeAppointmentInput(valid({ customerName: source })).customerName, normalized));
}
for (const value of ['', '   ', null, 1, [], 'x'.repeat(201), 'A\u0000lex']) test(`rejects invalid customer name ${String(value)}`, () => invalid(valid({ customerName: value }), 'customerName'));
test('normalizes customer ID and preserves legacy empty compatibility', () => {
    assert.equal(normalizeAppointmentInput(valid({ customerId: ' customer-1 ' })).customerId, 'customer-1');
    assert.equal(normalizeAppointmentInput(valid({ customerId: '' })).customerId, '');
    assert.equal(normalizeAppointmentInput(valid({ customerId: '   ' })).customerId, '');
    assert.equal(normalizeAppointmentInput({ customerName: 'Alex', date: '2026-09-25', time: '08:00' }).customerId, '');
    assert.equal(normalizeAppointmentInput(valid({ customerId: null })).customerId, '');
});
for (const value of [1, [], {}, 'x'.repeat(129), 'bad\nvalue']) test(`rejects invalid customer ID ${String(value)}`, () => invalid(valid({ customerId: value }), 'customerId'));
for (const value of ['2026-09-25', '2028-02-29', '0001-01-01']) test(`accepts calendar date ${value}`, () => assert.equal(normalizeAppointmentInput(valid({ date: value })).date, value));
for (const value of ['2025-02-29', '2026-02-30', '2026-13-01', '2026-2-5', '25-09-2026', '', null, 1]) test(`rejects invalid calendar date ${String(value)}`, () => invalid(valid({ date: value }), 'date'));
for (const value of ['00:00', '08:00', '17:30', '23:59']) test(`accepts clock time ${value}`, () => assert.equal(normalizeAppointmentInput(valid({ time: value })).time, value));
for (const value of ['24:00', '12:60', '8:00', '12 PM', '', null, 1]) test(`rejects invalid clock time ${String(value)}`, () => invalid(valid({ time: value }), 'time'));
for (const status of ['pending', 'completed', 'cancelled']) test(`accepts status ${status}`, () => assert.equal(normalizeAppointmentInput(valid({ status })).status, status));
test('omitted status defaults to pending', () => {
    const input = valid(); delete input.status;
    assert.equal(normalizeAppointmentInput(input).status, 'pending');
});
for (const value of ['Pending', 'done', 'complete', 'canceled', 'active', 1, true, null]) test(`rejects invalid status ${String(value)}`, () => invalid(valid({ status: value }), 'status'));
for (const field of ['service', 'staff']) {
    test(`normalizes optional ${field}`, () => {
        assert.equal(normalizeAppointmentInput(valid({ [field]: undefined }))[field], '');
        assert.equal(normalizeAppointmentInput(valid({ [field]: null }))[field], '');
        assert.equal(normalizeAppointmentInput(valid({ [field]: '  ' }))[field], '');
        assert.equal(normalizeAppointmentInput(valid({ [field]: '  Value  ' }))[field], 'Value');
    });
    for (const value of [1, [], {}, 'x'.repeat(201), 'bad\tvalue']) test(`rejects invalid ${field} ${String(value)}`, () => invalid(valid({ [field]: value }), field));
}
test('does not mutate input and returns detached plain data', () => {
    const input = valid({ customerName: '  Alex  ', customerId: ' customer-1 ', service: '  Consulting  ' });
    const before = structuredClone(input);
    const result = normalizeAppointmentInput(input);
    assert.deepEqual(input, before);
    assert.notEqual(result, input);
    result.service = 'Changed';
    assert.equal(input.service, '  Consulting  ');
});
