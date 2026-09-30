import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AppointmentMutationError,
    buildAppointmentCancellation,
    buildAppointmentCompletion,
    buildAppointmentCreate,
    buildAppointmentUpdate,
    createAppointmentInFlightGuard
} from '../js/features/appointmentCrud.js';
import { AppointmentValidationError } from '../js/features/appointmentContract.js';

const input = (extra = {}) => ({
    customerName: 'Alex Customer', customerId: 'customer-1', date: '2026-10-01', time: '09:30',
    service: 'Consulting', staff: 'Taylor', status: 'pending', ...extra
});
let stampCount = 0;
const timestamp = () => ({ serverTimestamp: ++stampCount });

test('create builds the complete canonical booking from authenticated uid', () => {
    stampCount = 0;
    assert.deepEqual(buildAppointmentCreate({ uid: 'user-a', input: input(), timestamp }), {
        ownerId: 'user-a', ...input(), createdAt: { serverTimestamp: 1 }, updatedAt: { serverTimestamp: 2 }
    });
});
test('create defaults optional appointment fields and pending status', () => {
    stampCount = 0;
    const minimal = { customerName: 'Alex Customer', date: '2026-10-01', time: '09:30' };
    const record = buildAppointmentCreate({ uid: 'user-a', input: minimal, timestamp });
    assert.equal(record.customerId, ''); assert.equal(record.service, ''); assert.equal(record.staff, ''); assert.equal(record.status, 'pending');
});
for (const field of ['ownerId', 'businessId', 'createdAt', 'updatedAt', 'completedAt']) {
    test(`protected create field ${field} cannot enter persistence`, () => {
        assert.throws(() => buildAppointmentCreate({ uid: 'user-a', input: input({ [field]: 'forged' }), timestamp }), AppointmentValidationError);
    });
}
test('authenticated uid wins because form ownership is rejected', () => {
    assert.throws(() => buildAppointmentCreate({ uid: 'user-a', input: input({ ownerId: 'user-b' }), timestamp }), AppointmentValidationError);
});
test('create requires an authenticated uid', () => {
    assert.throws(() => buildAppointmentCreate({ uid: '', input: input(), timestamp }), error => error instanceof AppointmentMutationError && error.code === 'UNAUTHENTICATED');
});
test('update writes only canonical editable fields and updatedAt', () => {
    stampCount = 0;
    const update = buildAppointmentUpdate({ input: input({ customerName: '  Updated  ' }), timestamp });
    assert.deepEqual(update, { ...input({ customerName: 'Updated' }), updatedAt: { serverTimestamp: 1 } });
    assert.deepEqual(Object.keys(update).sort(), ['customerId', 'customerName', 'date', 'service', 'staff', 'status', 'time', 'updatedAt']);
});
for (const field of ['ownerId', 'createdAt', 'completedAt', 'unknownCachedField']) {
    test(`update rejects cached/protected ${field}`, () => {
        assert.throws(() => buildAppointmentUpdate({ input: input({ [field]: 'not forwarded' }), timestamp }), AppointmentValidationError);
    });
}
for (const [field, value] of [['date', '2026-02-30'], ['time', '24:00'], ['status', 'done'], ['customerName', '   ']]) {
    test(`invalid ${field} rejects before a write payload is produced`, () => {
        assert.throws(() => buildAppointmentCreate({ uid: 'user-a', input: input({ [field]: value }), timestamp }), AppointmentValidationError);
    });
}
test('completion is a controlled status update with server timestamps', () => {
    stampCount = 0;
    assert.deepEqual(buildAppointmentCompletion({ timestamp }), { status: 'completed', completedAt: { serverTimestamp: 1 }, updatedAt: { serverTimestamp: 2 } });
});
test('cancellation is a controlled status update and never a delete payload', () => {
    stampCount = 0;
    assert.deepEqual(buildAppointmentCancellation({ timestamp }), { status: 'cancelled', updatedAt: { serverTimestamp: 1 } });
});
test('in-flight guard rejects a duplicate create while retaining one operation', async () => {
    const guard = createAppointmentInFlightGuard(); let release; let calls = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const first = guard.run('create:user-a', async () => { calls += 1; await pending; });
    assert.equal(await guard.run('create:user-a', async () => { calls += 1; }), false);
    release(); assert.equal(await first, true); assert.equal(calls, 1);
});
for (const action of ['edit:booking-a', 'complete:booking-a', 'cancel:booking-a', 'delete:booking-a']) {
    test(`in-flight guard prevents duplicate ${action.split(':')[0]}`, async () => {
        const guard = createAppointmentInFlightGuard(); let release;
        const first = guard.run(action, () => new Promise(resolve => { release = resolve; }));
        assert.equal(await guard.run(action, async () => {}), false);
        release(); assert.equal(await first, true);
    });
}
test('in-flight guard releases after a failed mutation so retry remains possible', async () => {
    const guard = createAppointmentInFlightGuard();
    await assert.rejects(guard.run('edit:booking-a', async () => { throw Error('offline'); }));
    assert.equal(await guard.run('edit:booking-a', async () => {}), true);
});
