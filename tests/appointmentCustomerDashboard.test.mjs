import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentCustomerOptions, prepareAppointmentCustomer } from '../js/features/appointmentCustomers.js';
import { dashboardTodayAppointments, dashboardUpcomingAppointments } from '../js/features/dashboardAppointments.js';

const customers = [
    { id: 'a', name: 'Alex', email: 'a@example.test' },
    { id: 'b', name: 'Alex', email: 'b@example.test' },
    { id: 'c', name: 'Casey' }
];
const booking = (extra = {}) => ({ id: 'one', date: '2026-10-02', time: '09:00', customerName: 'Alex', customerId: 'a', service: 'Test', staff: '', status: 'pending', ...extra });

test('customer options retain real IDs and disambiguate duplicate names', () => {
    const options = appointmentCustomerOptions(customers);
    assert.equal(options.find(option => option.value === 'a').label, 'Alex (a@example.test)');
    assert.equal(options.find(option => option.value === 'b').label, 'Alex (b@example.test)');
});
test('selected customer supplies both canonical ID and name snapshot without name guessing', () => {
    const value = prepareAppointmentCustomer({ customers, values: { customerId: 'b' } });
    assert.deepEqual(value, { customerId: 'b', customerName: 'Alex' });
    assert.throws(() => prepareAppointmentCustomer({ customers, values: { customerId: 'missing', customerName: 'Alex' } }), { code: 'INVALID_APPOINTMENT' });
});
test('legacy customer name remains readable only when unchanged during edit', () => {
    const legacy = prepareAppointmentCustomer({ customers, values: { customerId: '' }, existing: { customerId: '', customerName: 'Legacy Alex' }, isEditing: true });
    assert.equal(legacy.customerName, 'Legacy Alex');
    assert.throws(() => prepareAppointmentCustomer({ customers, values: { customerId: '' } }), { code: 'INVALID_APPOINTMENT' });
});
test('dashboard today uses local date and upcoming excludes completed and cancelled', () => {
    const now = new Date(2026, 9, 1, 12);
    const records = [booking({ id: 'later', date: '2026-11-01', time: '10:00' }), booking({ id: 'early', date: '2026-10-02', time: '08:00' }), booking({ id: 'done', status: 'completed' }), booking({ id: 'cancelled', status: 'cancelled' }), booking({ id: 'today', date: '2026-10-01' }), booking({ id: 'bad', date: 'invalid', time: 'bad' })];
    assert.deepEqual(dashboardTodayAppointments(records, now).map(record => record.id), ['today']);
    assert.deepEqual(dashboardUpcomingAppointments(records, now).map(record => record.id), ['today', 'early', 'later']);
});
