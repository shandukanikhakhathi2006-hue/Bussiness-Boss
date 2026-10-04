import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureInitialOwnerBusiness, resolveTrustedBusinessContext, BusinessContextError } from '../server/businessContextRepository.js';

class Ref {
    constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
    collection(name) { return new Collection(this.db, `${this.path}/${name}`); }
}
class Query { constructor(db, path, field, value, count) { Object.assign(this, { db, path, field, value, count }); } limit(count) { return new Query(this.db, this.path, this.field, this.value, count); } }
class Collection {
    constructor(db, path) { this.db = db; this.path = path; }
    doc(id = `business-${++this.db.nextId}`) { return new Ref(this.db, `${this.path}/${id}`); }
    where(field, _operator, value) { return new Query(this.db, this.path, field, value); }
}
const snapshot = (ref, value) => ({ exists: value !== undefined, ref, data: () => value });
class Transaction {
    constructor(db) { this.db = db; }
    async get(target) {
        if (target instanceof Query) {
            const prefix = `${target.path}/`; const depth = target.path.split('/').length + 1;
            const docs = [...this.db.docs.entries()].filter(([path, value]) => path.startsWith(prefix) && path.split('/').length === depth && value[target.field] === target.value)
                .slice(0, target.count ?? Infinity).map(([path, value]) => snapshot(new Ref(this.db, path), value));
            return { size: docs.length, docs };
        }
        return snapshot(target, this.db.docs.get(target.path));
    }
    async getAll(...refs) { return Promise.all(refs.map(ref => this.get(ref))); }
    create(ref, value) { if (this.db.docs.has(ref.path)) throw new Error('already exists'); this.db.docs.set(ref.path, structuredClone(value)); }
    set(ref, value, options = {}) { const existing = this.db.docs.get(ref.path); this.db.docs.set(ref.path, options.merge ? { ...existing, ...structuredClone(value) } : structuredClone(value)); }
}
class MemoryDb {
    constructor() { this.docs = new Map(); this.nextId = 0; }
    collection(path) { return new Collection(this, path); }
    async runTransaction(callback) { return callback(new Transaction(this)); }
}
const FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' };
const provision = (db, uid) => ensureInitialOwnerBusiness({ db, verifiedUid: uid, FieldValue });
const expectCode = async (work, code) => assert.rejects(work, error => error instanceof BusinessContextError && error.code === code);

test('new authenticated owner receives one opaque active business, membership and routing profile', async () => {
    const db = new MemoryDb(); const context = await provision(db, 'owner-a');
    assert.equal(context.businessId, 'business-1'); assert.deepEqual(context, { businessId: 'business-1', ownerId: 'owner-a', role: 'owner', status: 'active' });
    assert.deepEqual(db.docs.get('businesses/business-1'), { ownerId: 'owner-a', status: 'active', createdAt: 'SERVER_TIMESTAMP', updatedAt: 'SERVER_TIMESTAMP' });
    assert.deepEqual(db.docs.get('businesses/business-1/members/owner-a'), { role: 'owner', status: 'active', createdAt: 'SERVER_TIMESTAMP', updatedAt: 'SERVER_TIMESTAMP' });
    assert.equal(db.docs.get('users/owner-a').defaultBusinessId, 'business-1');
});

test('repeated provisioning is idempotent and never creates a second business', async () => {
    const db = new MemoryDb(); const first = await provision(db, 'owner-a'); const second = await provision(db, 'owner-a');
    assert.deepEqual(second, first); assert.equal([...db.docs.keys()].filter(path => /^businesses\/[^/]+$/.test(path)).length, 1);
});

test('existing unique owned business is reused and becomes the default route', async () => {
    const db = new MemoryDb(); db.docs.set('businesses/existing', { ownerId: 'owner-a', status: 'active' });
    const context = await provision(db, 'owner-a');
    assert.equal(context.businessId, 'existing'); assert.equal(db.docs.get('users/owner-a').defaultBusinessId, 'existing');
    assert.equal(db.docs.get('businesses/existing/members/owner-a').role, 'owner');
});

test('an existing owner route recovers a missing owner member server-side', async () => {
    const db = new MemoryDb();
    db.docs.set('users/owner-a', { defaultBusinessId: 'existing' });
    db.docs.set('businesses/existing', { ownerId: 'owner-a', status: 'active' });
    const context = await provision(db, 'owner-a');
    assert.equal(context.businessId, 'existing');
    assert.deepEqual(db.docs.get('businesses/existing/members/owner-a'), {
        role: 'owner', status: 'active', createdAt: 'SERVER_TIMESTAMP', updatedAt: 'SERVER_TIMESTAMP'
    });
});

test('another user business cannot be adopted through defaultBusinessId', async () => {
    const db = new MemoryDb(); db.docs.set('users/owner-a', { defaultBusinessId: 'other' });
    db.docs.set('businesses/other', { ownerId: 'owner-b', status: 'active' }); db.docs.set('businesses/other/members/owner-a', { role: 'owner', status: 'active' });
    await expectCode(() => provision(db, 'owner-a'), 'BUSINESS_ACCESS_DENIED');
});

test('trusted resolver checks active owner membership instead of trusting a route', async () => {
    const db = new MemoryDb(); db.docs.set('businesses/business-a', { ownerId: 'owner-a', status: 'active' });
    db.docs.set('businesses/business-a/members/owner-a', { role: 'owner', status: 'active' });
    const result = await db.runTransaction(tx => resolveTrustedBusinessContext(tx, db, 'owner-a', 'business-a'));
    assert.deepEqual(result, { businessId: 'business-a', ownerId: 'owner-a', role: 'owner', status: 'active' });
    await expectCode(() => db.runTransaction(tx => resolveTrustedBusinessContext(tx, db, 'owner-b', 'business-a')), 'BUSINESS_ACCESS_DENIED');
});

test('a missing business route is not mistaken for a membership failure', async () => {
    const db = new MemoryDb();
    await expectCode(() => db.runTransaction(tx => resolveTrustedBusinessContext(tx, db, 'owner-a', 'missing')), 'BUSINESS_NOT_FOUND');
});
