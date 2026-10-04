import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import { createProductionInvoiceDraft, readProductionInvoiceDraft, updateProductionInvoiceDraft } from '../server/productionInvoiceDraftRepository.js';

class Ref {
    constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
    collection(name) { return new Collection(this.db, `${this.path}/${name}`); }
}
class Collection {
    constructor(db, path) { this.db = db; this.path = path; }
    doc(id) { return new Ref(this.db, `${this.path}/${id}`); }
}
const snapshot = (ref, value) => ({ exists: value !== undefined, ref, data: () => value });
class Transaction {
    constructor(db) { this.db = db; }
    async get(ref) { return snapshot(ref, this.db.docs.get(ref.path)); }
    async getAll(...refs) { return Promise.all(refs.map(ref => this.get(ref))); }
    create(ref, value) { if (this.db.docs.has(ref.path)) throw new Error('exists'); this.db.docs.set(ref.path, value); }
    update(ref, value) { this.db.docs.set(ref.path, { ...this.db.docs.get(ref.path), ...value }); }
}
class MemoryDb {
    constructor() { this.docs = new Map(); }
    collection(path) { return new Collection(this, path); }
    runTransaction(work) { return work(new Transaction(this)); }
}
const draft = () => ({ customerId: null, customerName: 'Customer', customerEmail: null, customerAddress: null,
    currency: 'ZAR', issueDate: null, dueDate: null, lineItems: [] });
const route = { businessId: 'business-a', invoiceId: 'draft-a' };
const seed = () => {
    const db = new MemoryDb();
    db.docs.set('businesses/business-a', { ownerId: 'owner-a', status: 'active' });
    db.docs.set('businesses/business-a/members/owner-a', { role: 'owner', status: 'active' });
    return db;
};
const code = expected => error => error?.code === expected;

test('production create/read/update use trusted tenant context and business-scoped persistence', async () => {
    const db = seed();
    assert.deepEqual(await createProductionInvoiceDraft(db, 'owner-a', { ...route, draft: draft() }), { invoiceId: 'draft-a', lifecycleStatus: 'draft' });
    assert.equal(db.docs.has('invoices/draft-a'), false);
    const stored = db.docs.get('businesses/business-a/invoices/draft-a');
    assert.equal(stored.ownerId, 'owner-a'); assert.equal(stored.revision, 1);
    stored.createdAt = new Timestamp(1, 0); stored.updatedAt = new Timestamp(1, 0);
    const loaded = await readProductionInvoiceDraft(db, 'owner-a', route);
    assert.equal(loaded.revision, 1); assert.equal(loaded.draft.customerName, 'Customer');
    assert.deepEqual(await updateProductionInvoiceDraft(db, 'owner-a', { ...route, expectedRevision: 1, input: { ...draft(), customerName: 'Updated' } }), { invoiceId: 'draft-a', revision: 2 });
    assert.equal(db.docs.get('businesses/business-a/invoices/draft-a').customer.name, 'Updated');
});

test('production tenant resolution rejects a foreign user, inactive business and inactive membership', async () => {
    const db = seed();
    await assert.rejects(() => createProductionInvoiceDraft(db, 'owner-b', { ...route, draft: draft() }), code('BUSINESS_ACCESS_DENIED'));
    db.docs.get('businesses/business-a').status = 'inactive';
    await assert.rejects(() => createProductionInvoiceDraft(db, 'owner-a', { ...route, draft: draft() }), code('BUSINESS_INACTIVE'));
    db.docs.get('businesses/business-a').status = 'active'; db.docs.get('businesses/business-a/members/owner-a').status = 'inactive';
    await assert.rejects(() => createProductionInvoiceDraft(db, 'owner-a', { ...route, draft: draft() }), code('BUSINESS_INACTIVE'));
});

test('all Invoice v2 callables select trusted production persistence and retain production App Check enforcement', () => {
    const save = readFileSync(new URL('../functions/src/saveInvoiceDraft.js', import.meta.url), 'utf8');
    const read = readFileSync(new URL('../functions/src/getInvoiceDraft.js', import.meta.url), 'utf8');
    const update = readFileSync(new URL('../functions/src/updateInvoiceDraft.js', import.meta.url), 'utf8');
    const options = readFileSync(new URL('../functions/src/localEnvironment.js', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../invoices-v2.html', import.meta.url), 'utf8');
    for (const source of [save, read, update]) {
        assert.match(source, /servicesForCurrentEnvironment/);
        assert.match(source, /BUSINESSBOSS_LOCAL_FUNCTIONS/);
    }
    assert.match(save, /createProductionInvoiceDraft/);
    assert.match(read, /readProductionInvoiceDraft/);
    assert.match(update, /updateProductionInvoiceDraft/);
    assert.match(options, /enforceAppCheck: !local/);
    assert.doesNotMatch(page, /Local demo|stage9n-demo-business/);
});
