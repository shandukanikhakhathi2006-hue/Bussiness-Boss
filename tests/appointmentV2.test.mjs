import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
    AppointmentCommandError, appointmentForInvoice, validateAppointmentInput
} from '../js/backend/appointmentCommand.js';
import {
    AppointmentRepositoryError, createAppointment, listAppointments, loadAppointmentForInvoice, updateAppointment
} from '../server/appointmentRepository.js';
import { assertLocalFunctionsEnvironment } from '../functions/src/localEnvironment.js';
import { assertProductionFunctionsEnvironment } from '../functions/src/productionEnvironment.js';

const stamp = { serverTimestamp: () => ({ server: true }) };
const input = (overrides = {}) => ({
    customerId: 'customer-a', date: '2026-10-15', time: '09:30', service: ' Consultation ', staff: ' Specialist ', ...overrides
});
const ownedSeed = {
    'businesses/business-a': { ownerId: 'owner-a', status: 'active' },
    'businesses/business-a/members/owner-a': { role: 'owner', status: 'active' },
    'businesses/business-a/customers/customer-a': {
        schemaVersion: 2, businessId: 'business-a', status: 'active', name: 'Thabo', email: null, phone: null
    },
    'businesses/business-a/customers/customer-b': {
        schemaVersion: 2, businessId: 'business-a', status: 'active', name: 'Thabo', email: null, phone: null
    }
};

class Ref {
    constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
    collection(name) { return new Collection(this.db, `${this.path}/${name}`); }
}
class Collection {
    constructor(db, path) { this.db = db; this.path = path; }
    doc(id = `generated-${this.db.next++}`) { return new Ref(this.db, `${this.path}/${id}`); }
}
const snapshot = (ref, value) => ({ exists: value !== undefined, ref, data: () => value });
const collectionSnapshot = (data, collection) => {
    const prefix = `${collection.path}/`;
    const docs = [...data.entries()].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, value]) => ({ id: path.slice(prefix.length), data: () => value }));
    return { docs, size: docs.length };
};

function fakeDb(seed = {}) {
    const data = new Map(Object.entries(seed));
    const db = {
        next: 1,
        collection: name => new Collection(db, name),
        runTransaction: async callback => {
            const writes = [];
            const transaction = {
                get: async ref => ref instanceof Collection ? collectionSnapshot(data, ref) : snapshot(ref, data.get(ref.path)),
                getAll: async (...refs) => refs.map(ref => snapshot(ref, data.get(ref.path))),
                create: (ref, value) => writes.push(['create', ref.path, value]),
                update: (ref, value) => writes.push(['update', ref.path, value])
            };
            const result = await callback(transaction);
            for (const [kind, path, value] of writes) {
                if (kind === 'create') data.set(path, value);
                else data.set(path, { ...data.get(path), ...value });
            }
            return result;
        }
    };
    return { db, data };
}

const rejects = async (operation, code) => assert.rejects(operation, error => error?.code === code);

test('Appointment v2 accepts only browser intent and preserves exact local calendar values', () => {
    assert.deepEqual(validateAppointmentInput(input()), {
        customerId: 'customer-a', date: '2026-10-15', time: '09:30', service: 'Consultation', staff: 'Specialist'
    });
    assert.equal(validateAppointmentInput(input({ date: '0001-01-01' })).date, '0001-01-01');
    assert.equal(validateAppointmentInput(input({ date: '2028-02-29' })).date, '2028-02-29');
    for (const value of [
        input({ date: '2026-02-30' }), input({ time: '9:30' }), input({ customerNameSnapshot: 'Forged' }),
        input({ invoiceId: 'invoice-a' }), input({ status: 'completed' }), input({ customerId: 'customer/a' })
    ]) assert.throws(() => validateAppointmentInput(value), AppointmentCommandError);
});

test('Appointment v2 creates a tenant-scoped record from the authoritative Customer v2 snapshot', async () => {
    const { db, data } = fakeDb(ownedSeed);
    const created = await createAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: {
        businessId: 'business-a', input: input()
    } });
    assert.equal(created.customerId, 'customer-a');
    assert.equal(created.customerNameSnapshot, 'Thabo');
    assert.equal(created.date, '2026-10-15'); assert.equal(created.time, '09:30');
    assert.equal(created.status, 'pending'); assert.equal(created.invoiceId, null);
    const stored = data.get(`businesses/business-a/appointments/${created.appointmentId}`);
    assert.equal(stored.businessId, 'business-a'); assert.equal(stored.createdBy, 'owner-a');
    assert.equal(stored.updatedBy, 'owner-a'); assert.equal(stored.createdAt.server, true);
    assert.equal(stored.customerNameSnapshot, 'Thabo'); assert.equal(stored.invoiceId, null);
    assert.equal(stored.ownerId, undefined); assert.equal(stored.status, 'pending');
});

test('Appointment v2 requires authenticated owner authority and an active Customer v2 in the same tenant', async () => {
    const missing = fakeDb(ownedSeed);
    await rejects(() => createAppointment({ db: missing.db, FieldValue: stamp, verifiedUid: '', data: { businessId: 'business-a', input: input() } }), 'UNAUTHENTICATED');
    await rejects(() => createAppointment({ db: missing.db, FieldValue: stamp, verifiedUid: 'owner-b', data: { businessId: 'business-a', input: input() } }), 'BUSINESS_ACCESS_DENIED');
    const inactiveMembership = fakeDb({ ...ownedSeed,
        'businesses/business-a/members/owner-a': { role: 'owner', status: 'inactive' }
    });
    await rejects(() => createAppointment({ db: inactiveMembership.db, FieldValue: stamp, verifiedUid: 'owner-a', data: { businessId: 'business-a', input: input() } }), 'BUSINESS_INACTIVE');
    await rejects(() => createAppointment({ db: missing.db, FieldValue: stamp, verifiedUid: 'owner-a', data: { businessId: 'business-a', input: input({ customerId: 'does-not-exist' }) } }), 'CUSTOMER_NOT_FOUND');

    const archived = fakeDb({ ...ownedSeed,
        'businesses/business-a/customers/customer-a': { ...ownedSeed['businesses/business-a/customers/customer-a'], status: 'archived' }
    });
    await rejects(() => createAppointment({ db: archived.db, FieldValue: stamp, verifiedUid: 'owner-a', data: { businessId: 'business-a', input: input() } }), 'CUSTOMER_ARCHIVED');

    const foreignCustomer = fakeDb({
        'businesses/business-a': { ownerId: 'owner-a', status: 'active' },
        'businesses/business-a/members/owner-a': { role: 'owner', status: 'active' },
        'businesses/business-b/customers/customer-a': ownedSeed['businesses/business-a/customers/customer-a']
    });
    await rejects(() => createAppointment({ db: foreignCustomer.db, FieldValue: stamp, verifiedUid: 'owner-a', data: { businessId: 'business-a', input: input() } }), 'CUSTOMER_NOT_FOUND');
});

test('Appointment v2 never resolves customers by name, including duplicate customer names', async () => {
    const { db, data } = fakeDb(ownedSeed);
    const selected = await createAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: {
        businessId: 'business-a', input: input({ customerId: 'customer-b' })
    } });
    assert.equal(selected.customerId, 'customer-b'); assert.equal(selected.customerNameSnapshot, 'Thabo');
    await rejects(() => createAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: {
        businessId: 'business-a', input: input({ customerId: 'Thabo' })
    } }), 'CUSTOMER_NOT_FOUND');
    assert.equal([...data.keys()].filter(path => path.includes('/appointments/')).length, 1);
});

test('Appointment v2 lists only its tenant records in deterministic calendar order', async () => {
    const { db } = fakeDb(ownedSeed);
    await createAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: { businessId: 'business-a', input: input({ date: '2026-10-18', time: '11:00' }) } });
    await createAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: { businessId: 'business-a', input: input({ date: '2026-10-15', time: '15:00' }) } });
    await createAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: { businessId: 'business-a', input: input({ date: '2026-10-15', time: '08:00' }) } });
    assert.deepEqual((await listAppointments({ db, verifiedUid: 'owner-a', data: { businessId: 'business-a' } }))
        .map(appointment => [appointment.date, appointment.time]), [
        ['2026-10-15', '08:00'], ['2026-10-15', '15:00'], ['2026-10-18', '11:00']
    ]);
});

test('Appointment v2 guards lifecycle transitions and server-protected invoice relation fields', async () => {
    const { db, data } = fakeDb(ownedSeed);
    const created = await createAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: {
        businessId: 'business-a', input: input()
    } });
    const update = { ...input({ service: 'Follow-up' }), status: 'completed' };
    const completed = await updateAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: {
        businessId: 'business-a', appointmentId: created.appointmentId, input: update
    } });
    assert.equal(completed.status, 'completed');
    await rejects(() => updateAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: {
        businessId: 'business-a', appointmentId: created.appointmentId, input: { ...input(), status: 'pending' }
    } }), 'INVALID_APPOINTMENT_TRANSITION');
    await rejects(() => updateAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: {
        businessId: 'business-a', appointmentId: created.appointmentId, input: { ...input(), status: 'not-a-status' }
    } }), 'INVALID_APPOINTMENT');
    await rejects(() => updateAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: {
        businessId: 'business-a', appointmentId: created.appointmentId, input: { ...input(), status: 'completed', invoiceId: 'forged' }
    } }), 'INVALID_APPOINTMENT');
    data.get(`businesses/business-a/appointments/${created.appointmentId}`).invoiceId = 'invoice-a';
    await rejects(() => updateAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: {
        businessId: 'business-a', appointmentId: created.appointmentId, input: { ...input(), status: 'completed' }
    } }), 'APPOINTMENT_INVOICED');
});

test('Appointment v2 permits non-customer edits after the referenced customer is archived but never replaces its trusted snapshot', async () => {
    const { db, data } = fakeDb(ownedSeed);
    const created = await createAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: {
        businessId: 'business-a', input: input()
    } });
    data.get('businesses/business-a/customers/customer-a').status = 'archived';
    const updated = await updateAppointment({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: {
        businessId: 'business-a', appointmentId: created.appointmentId,
        input: { ...input({ service: 'Historical follow-up' }), status: 'completed' }
    } });
    assert.equal(updated.status, 'completed'); assert.equal(updated.customerNameSnapshot, 'Thabo');
    assert.equal(data.get(`businesses/business-a/appointments/${created.appointmentId}`).customerNameSnapshot, 'Thabo');
});

test('future invoice eligibility requires a completed, unlinked canonical appointment in its tenant', async () => {
    const base = { schemaVersion: 2, businessId: 'business-a', customerId: 'customer-a', customerNameSnapshot: 'Thabo', date: '2026-10-15', time: '09:30', service: 'Consultation', staff: '', invoiceId: null };
    assert.deepEqual(appointmentForInvoice('appointment-a', { ...base, status: 'completed' }), {
        appointmentId: 'appointment-a', customerId: 'customer-a', customerNameSnapshot: 'Thabo', date: '2026-10-15', service: 'Consultation'
    });
    assert.throws(() => appointmentForInvoice('appointment-a', { ...base, status: 'pending' }), error => error.code === 'APPOINTMENT_NOT_COMPLETED');
    assert.throws(() => appointmentForInvoice('appointment-a', { ...base, status: 'cancelled' }), error => error.code === 'APPOINTMENT_NOT_COMPLETED');
    assert.throws(() => appointmentForInvoice('appointment-a', { ...base, status: 'completed', invoiceId: 'invoice-a' }), error => error.code === 'APPOINTMENT_ALREADY_INVOICED');

    const { db } = fakeDb({ ...ownedSeed, 'businesses/business-a/appointments/appointment-a': { ...base, status: 'completed' } });
    const transaction = { get: async ref => snapshot(ref, undefined) };
    const actualTransaction = { get: async ref => snapshot(ref, ref.path === 'businesses/business-a/appointments/appointment-a' ? { ...base, status: 'completed' } : undefined) };
    assert.equal((await loadAppointmentForInvoice({ transaction: actualTransaction, db, businessId: 'business-a', appointmentId: 'appointment-a' })).customerId, 'customer-a');
    await rejects(() => loadAppointmentForInvoice({ transaction, db, businessId: 'business-b', appointmentId: 'appointment-a' }), 'APPOINTMENT_NOT_FOUND');
    const corruptTenant = { get: async ref => snapshot(ref, { ...base, businessId: 'business-b', status: 'completed' }) };
    await rejects(() => loadAppointmentForInvoice({ transaction: corruptTenant, db, businessId: 'business-a', appointmentId: 'appointment-a' }), 'INTERNAL');
});

test('Appointment callables retain the verified local/production environment split and no browser authority', () => {
    assert.doesNotThrow(() => assertLocalFunctionsEnvironment({
        BUSINESSBOSS_LOCAL_FUNCTIONS: 'true', FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', GCLOUD_PROJECT: 'demo-businessboss-rules'
    }));
    assert.throws(() => assertProductionFunctionsEnvironment({ GCLOUD_PROJECT: 'business-boss-1b871', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }));
    const index = fs.readFileSync(new URL('../functions/src/index.js', import.meta.url), 'utf8');
    const callable = fs.readFileSync(new URL('../functions/src/appointmentV2.js', import.meta.url), 'utf8');
    assert.match(index, /export const createAppointment = onCall\(callableOptions\(\), handleCreateAppointment\)/);
    assert.match(index, /export const updateAppointment = onCall\(callableOptions\(\), handleUpdateAppointment\)/);
    assert.match(callable, /auth\.verifyIdToken\(request\.auth\.rawToken, true\)/);
    assert.doesNotMatch(callable, /customerNameSnapshot|invoiceId|ownerId|role|membership/);
});
