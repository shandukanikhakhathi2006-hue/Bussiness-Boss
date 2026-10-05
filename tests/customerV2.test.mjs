import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
    CustomerCommandError, customerSnapshotForInvoice, projectCustomer, validateCustomerInput
} from '../js/backend/customerCommand.js';
import {
    archiveCustomer, createCustomer, CustomerRepositoryError, loadCustomerForInvoice
} from '../server/customerRepository.js';

const stamp = { serverTimestamp: () => ({ server: true }) };
const customer = (overrides = {}) => ({ schemaVersion: 2, businessId: 'business-a', status: 'active', name: ' Thabo ', email: ' thabo@example.test ', phone: ' 071 000 0000 ', ...overrides });
const throws = async (operation, code) => assert.rejects(operation, error => error?.code === code);

class Ref {
    constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
    collection(name) { return new Collection(this.db, `${this.path}/${name}`); }
}
class Collection {
    constructor(db, path) { this.db = db; this.path = path; }
    doc(id = `generated-${this.db.next++}`) { return new Ref(this.db, `${this.path}/${id}`); }
}
const snapshot = data => ({ exists: data !== undefined, data: () => data });

function fakeDb(seed = {}) {
    const data = new Map(Object.entries(seed));
    const db = {
        next: 1,
        collection: name => new Collection(db, name),
        runTransaction: async callback => {
            const writes = [];
            const transaction = {
                get: async ref => snapshot(data.get(ref.path)),
                getAll: async (...refs) => refs.map(ref => snapshot(data.get(ref.path))),
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

const ownedSeed = {
    'businesses/business-a': { ownerId: 'owner-a', status: 'active' },
    'businesses/business-a/members/owner-a': { role: 'owner', status: 'active' }
};

test('Customer v2 normalizes supported fields and rejects browser authority', () => {
    assert.deepEqual(validateCustomerInput({ name: ' Thabo ', email: ' thabo@example.test ', phone: ' 071 000 0000 ' }), {
        name: 'Thabo', email: 'thabo@example.test', phone: '071 000 0000'
    });
    assert.throws(() => validateCustomerInput({ name: 'Thabo', ownerId: 'owner-a' }), CustomerCommandError);
    assert.throws(() => validateCustomerInput({ name: '   ' }), CustomerCommandError);
    assert.throws(() => validateCustomerInput({ name: 'Thabo', email: 'not-an-email' }), CustomerCommandError);
    assert.throws(() => validateCustomerInput(Object.create({ name: 'Inherited Thabo' })), CustomerCommandError);
});

test('Customer v2 creates distinct same-name records with server-owned tenant fields', async () => {
    const { db, data } = fakeDb(ownedSeed);
    const first = await createCustomer({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: { businessId: 'business-a', input: { name: 'Thabo' } } });
    const second = await createCustomer({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: { businessId: 'business-a', input: { name: 'Thabo' } } });
    assert.notEqual(first.customerId, second.customerId);
    assert.equal(first.status, 'active');
    const stored = data.get(`businesses/business-a/customers/${first.customerId}`);
    assert.equal(stored.businessId, 'business-a');
    assert.equal(stored.createdBy, 'owner-a');
    assert.equal(stored.ownerId, undefined);
    assert.equal(stored.createdAt.server, true);
});

test('Customer v2 rejects missing, inactive, and foreign tenant authority', async () => {
    const missing = fakeDb();
    await throws(() => createCustomer({ db: missing.db, FieldValue: stamp, verifiedUid: 'owner-a', data: { businessId: 'business-a', input: { name: 'Thabo' } } }), 'BUSINESS_NOT_FOUND');
    const inactive = fakeDb({
        'businesses/business-a': { ownerId: 'owner-a', status: 'active' },
        'businesses/business-a/members/owner-a': { role: 'owner', status: 'inactive' }
    });
    await throws(() => createCustomer({ db: inactive.db, FieldValue: stamp, verifiedUid: 'owner-a', data: { businessId: 'business-a', input: { name: 'Thabo' } } }), 'BUSINESS_INACTIVE');
    const foreign = fakeDb({
        'businesses/business-a': { ownerId: 'owner-b', status: 'active' },
        'businesses/business-a/members/owner-a': { role: 'owner', status: 'active' }
    });
    await throws(() => createCustomer({ db: foreign.db, FieldValue: stamp, verifiedUid: 'owner-a', data: { businessId: 'business-a', input: { name: 'Thabo' } } }), 'BUSINESS_ACCESS_DENIED');
});

test('Customer v2 archive is authoritative and invoice snapshots reject archived or foreign records', async () => {
    const { db, data } = fakeDb({ ...ownedSeed, 'businesses/business-a/customers/customer-a': customer() });
    const archived = await archiveCustomer({ db, FieldValue: stamp, verifiedUid: 'owner-a', data: { businessId: 'business-a', customerId: 'customer-a' } });
    assert.equal(archived.status, 'archived');
    const transaction = { get: async ref => snapshot(data.get(ref.path)) };
    await throws(() => loadCustomerForInvoice({ transaction, db, businessId: 'business-a', customerId: 'customer-a' }), 'CUSTOMER_ARCHIVED');
    await throws(() => loadCustomerForInvoice({ transaction, db, businessId: 'business-b', customerId: 'customer-a' }), 'CUSTOMER_NOT_FOUND');
});

test('Customer v2 invoice snapshot is server-derived and never name-based', () => {
    assert.deepEqual(customerSnapshotForInvoice('customer-a', customer()), {
        customerId: 'customer-a', customerNameSnapshot: 'Thabo', customerEmailSnapshot: 'thabo@example.test', customerPhoneSnapshot: '071 000 0000'
    });
    assert.deepEqual(projectCustomer('customer-a', customer({ name: 'Thabo', email: null, phone: null })), {
        customerId: 'customer-a', name: 'Thabo', email: null, phone: null, status: 'active'
    });
});

test('Customer v2 callable exports use the existing verified callable composition', () => {
    const functionsIndex = fs.readFileSync(new URL('../functions/src/index.js', import.meta.url), 'utf8');
    const callable = fs.readFileSync(new URL('../functions/src/customerV2.js', import.meta.url), 'utf8');
    assert.match(functionsIndex, /export const createCustomer = onCall\(callableOptions\(\), handleCreateCustomer\)/);
    assert.match(functionsIndex, /export const archiveCustomer = onCall\(callableOptions\(\), handleArchiveCustomer\)/);
    assert.match(callable, /auth\.verifyIdToken\(request\.auth\.rawToken, true\)/);
    assert.doesNotMatch(callable, /ownerId|role|membership/);
});
