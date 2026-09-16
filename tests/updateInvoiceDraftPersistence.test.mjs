import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Timestamp } from 'firebase-admin/firestore';
import { createEmulatorAdmin } from './server/emulatorAdmin.mjs';
import { createEmulatorInvoiceDraftUpdateRepository, updateDraftInTransaction, safeUpdateError,
    InvoiceDraftUpdatePersistenceError } from './server/emulatorInvoiceDraftUpdateRepository.mjs';
import { assertServerEmulatorEnvironment, waitForFirestore } from './emulatorEnvironment.mjs';
import { validateInvoiceDraft } from '../js/finance/invoiceDraftValidator.js';

let admin, repository;
const line = () => ({ id: 'line-1', description: 'Consulting', quantity: '1.500', unitPriceMinor: 1000,
    discountMinor: 100, taxRateBps: 1000, taxCode: 'STANDARD', catalogItemId: null });
const minimal = () => ({ currency: 'ZAR', lineItems: [] });
const full = () => ({ customerName: ' New customer ', customerEmail: 'new@example.test', customerAddress: ' Road\r\nCity ',
    currency: 'ZAR', issueDate: null, dueDate: null, lineItems: [line()] });
const initial = () => ({ schemaVersion: 2, businessId: 'update-business', ownerId: 'update-owner',
    lifecycleStatus: 'draft', paymentStatus: 'not_due', revision: 1,
    customer: { id: null, name: 'Old customer', email: null, address: null }, currency: 'ZAR', issueDate: null, dueDate: null,
    lineItems: [{ ...line(), subtotalMinor: 1500, taxMinor: 140, totalMinor: 1540 }],
    subtotalMinor: 1500, discountMinor: 100, taxMinor: 140, totalMinor: 1540, amountPaidMinor: 0, balanceDueMinor: 1540,
    createdBy: 'historical-creator', updatedBy: 'historical-editor', createdAt: new Timestamp(100, 123), updatedAt: new Timestamp(101, 456) });
const business = () => admin.db.doc('businesses/update-business');
const member = () => business().collection('members').doc('update-owner');
const target = () => business().collection('invoices').doc('draft-1');
const args = (input = full()) => ({ businessId: 'update-business', invoiceId: 'draft-1', verifiedUid: 'update-owner', expectedRevision: 1, input });
const update = (command = args()) => repository.updateInvoiceDraftTransaction(command);
const current = async () => (await target().get()).data();
const expect = (promise, code) => assert.rejects(promise, error => {
    assert.ok(error instanceof InvoiceDraftUpdatePersistenceError); assert.equal(error.code, code);
    assert.equal(error.stack, undefined); assert.equal(error.cause, undefined); return true;
});
async function noWrite(command, code) {
    const original = await current(); await expect(update(command), code); assert.deepEqual(await current(), original);
}
before(async () => { assertServerEmulatorEnvironment(process.env); await waitForFirestore(); admin = createEmulatorAdmin(); repository = createEmulatorInvoiceDraftUpdateRepository(); });
beforeEach(async () => {
    const response = await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-businessboss-rules/databases/(default)/documents', { method: 'DELETE' });
    assert.equal(response.ok, true); await response.body?.cancel();
    await business().set({ ownerId: 'update-owner', active: true });
    await member().set({ uid: 'update-owner', active: true, role: 'owner' });
    await target().set(initial());
});
after(async () => { await repository?.close(); await admin?.close(); });

for (const revision of [1, 4]) test(`successful full update ${revision} → ${revision + 1} preserves exact protected state`, async () => {
    await target().update({ revision }); const original = await current(), command = { ...args(), expectedRevision: revision };
    assert.deepEqual(await update(command), { invoiceId: 'draft-1', revision: revision + 1 });
    const stored = await current(); const normalized = validateInvoiceDraft(command.input);
    assert.deepEqual(stored, { ...original, revision: revision + 1,
        customer: { id: null, name: 'New customer', email: 'new@example.test', address: 'Road\nCity' },
        lineItems: normalized.lineItems, ...normalized.totals, balanceDueMinor: 1540,
        updatedBy: 'update-owner', updatedAt: stored.updatedAt });
    assert.ok(stored.updatedAt instanceof Timestamp); assert.ok(stored.updatedAt.seconds > original.updatedAt.seconds);
    assert.equal(stored.amountPaidMinor, 0); assert.equal(stored.paymentStatus, 'not_due');
});
test('minimal full replacement removes old content and permits zero/incomplete draft', async () => {
    await update(args(minimal())); const stored = await current();
    assert.deepEqual(stored.customer, { id: null, name: '', email: null, address: null });
    assert.deepEqual(stored.lineItems, []); assert.equal(stored.totalMinor, 0); assert.equal(stored.balanceDueMinor, 0);
    assert.equal(stored.issueDate, null); assert.equal(stored.dueDate, null); assert.equal(stored.revision, 2);
});
test('line order and recalculated changed prices persist', async () => {
    const input = full(); input.lineItems = [{ ...line(), id: 'second', unitPriceMinor: 2000 }, { ...line(), id: 'first' }];
    await update(args(input)); const stored = await current();
    assert.deepEqual(stored.lineItems.map(l => l.id), ['second', 'first']);
    assert.equal(stored.subtotalMinor, 4500); assert.equal(stored.discountMinor, 200); assert.equal(stored.taxMinor, 430);
    assert.equal(stored.totalMinor, 4730); assert.equal(stored.balanceDueMinor, 4730);
});
test('identical semantic content still increments revision and refreshes audit fields', async () => {
    const original = await current(); const input = { currency: 'ZAR', lineItems: [line()], customerName: 'Old customer' };
    await update(args(input)); const stored = await current();
    assert.deepEqual(stored, { ...original, revision: 2, updatedBy: 'update-owner', updatedAt: stored.updatedAt });
    assert.ok(!stored.updatedAt.isEqual(original.updatedAt));
});
test('stale revision leaves complete invoice unchanged', async () => {
    await target().update({ revision: 5 }); await noWrite({ ...args(), expectedRevision: 4 }, 'INVOICE_REVISION_CONFLICT');
});
test('matching maximum revision fails without overflow', async () => {
    await target().update({ revision: Number.MAX_SAFE_INTEGER }); await noWrite({ ...args(), expectedRevision: Number.MAX_SAFE_INTEGER }, 'INTERNAL');
});
test('stale maximum revision conflicts before overflow', async () => {
    await target().update({ revision: Number.MAX_SAFE_INTEGER }); await noWrite(args(), 'INVOICE_REVISION_CONFLICT');
});
for (const expectedRevision of [null, '1', true, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) test(`invalid expectedRevision ${expectedRevision}`, () => noWrite({ ...args(), expectedRevision }, 'INVALID_REQUEST'));
test('missing precondition rejected before I/O', async () => { const command = args(); delete command.expectedRevision; await noWrite(command, 'INVALID_REQUEST'); });

test('two concurrent expectedRevision 10 writers produce one winner at 11', async () => {
    await target().update({ revision: 10 });
    const commands = ['A', 'B'].map(name => ({ ...args({ ...full(), customerName: name }), expectedRevision: 10 }));
    const results = await Promise.allSettled(commands.map(update));
    const winner = results.findIndex(result => result.status === 'fulfilled');
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const loser = results.find(result => result.status === 'rejected').reason;
    assert.equal(loser.code, 'INVOICE_REVISION_CONFLICT'); assert.equal(loser.stack, undefined);
    const stored = await current(); assert.equal(stored.revision, 11);
    assert.equal(stored.customer.name, commands[winner].input.customerName);
    assert.deepEqual(stored.lineItems, validateInvoiceDraft(commands[winner].input).lineItems);
});

for (const [label, mutate, code] of [
    ['missing membership', () => member().delete(), 'BUSINESS_ACCESS_DENIED'],
    ['inactive membership', () => member().update({ active: false }), 'BUSINESS_ACCESS_DENIED'],
    ['wrong member uid', () => member().update({ uid: 'other' }), 'BUSINESS_ACCESS_DENIED'],
    ['malformed member active', () => member().update({ active: 'true' }), 'BUSINESS_ACCESS_DENIED'],
    ['malformed member role', () => member().update({ role: 2 }), 'BUSINESS_ACCESS_DENIED'],
    ['wrong business owner', () => business().update({ ownerId: 'other' }), 'BUSINESS_ACCESS_DENIED'],
    ['inactive business', () => business().update({ active: false }), 'BUSINESS_INACTIVE'],
    ['archived business', () => business().update({ archived: true }), 'BUSINESS_INACTIVE'],
    ['malformed business', () => business().update({ active: 'true' }), 'INTERNAL'],
    ['malformed timezone', () => business().update({ timezone: 'unknown/timezone' }), 'INTERNAL'],
    ['missing business with member', () => business().delete(), 'BUSINESS_NOT_FOUND']
]) test(label, async () => { await mutate(); await noWrite(args(), code); });
for (const role of ['staff', 'accountant', 'viewer', 'Owner', 'OWNER']) test(`role ${role} denied without invoice mutation`, async () => {
    await member().update({ role }); await noWrite(args(), 'INVALID_BUSINESS_ROLE');
});
test('nonmember cannot discover nonexistent business', async () => {
    await business().delete(); await member().delete(); await noWrite(args(), 'BUSINESS_ACCESS_DENIED');
});
test('another active member cannot impersonate owner', async () => {
    await business().collection('members').doc('other').set({ uid: 'other', active: true, role: 'staff' });
    await noWrite({ ...args(), verifiedUid: 'other' }, 'BUSINESS_ACCESS_DENIED');
});
test('authorization and candidate validation precede target-not-found disclosure', async () => {
    await target().delete(); await member().update({ role: 'staff' }); await expect(update(), 'INVALID_BUSINESS_ROLE');
    await member().update({ role: 'owner' }); await expect(update(args({ currency: 'USD', lineItems: [] })), 'INVALID_INVOICE_DRAFT');
    assert.equal((await target().get()).exists, false);
});
test('missing invoice never upserts', async () => {
    await target().delete(); await expect(update(), 'INVOICE_NOT_FOUND'); assert.equal((await target().get()).exists, false);
});

for (const [label, change] of [
    ['missing revision', s => { delete s.revision; }], ['string revision', s => { s.revision = '1'; }],
    ['zero revision', s => { s.revision = 0; }], ['wrong tenant', s => { s.businessId = 'other'; }],
    ['wrong owner', s => { s.ownerId = 'other'; }], ['wrong schema', s => { s.schemaVersion = 1; }],
    ['bad lifecycle', s => { s.lifecycleStatus = 'Draft'; }], ['bad subtotal', s => { s.subtotalMinor++; }],
    ['bad discount', s => { s.discountMinor++; }], ['bad tax', s => { s.taxMinor++; }], ['bad total', s => { s.totalMinor++; }],
    ['bad balance', s => { s.balanceDueMinor++; }], ['paid amount', s => { s.amountPaidMinor = 1; }],
    ['payment status', s => { s.paymentStatus = 'paid'; }], ['customer reference', s => { s.customer.id = 'customer'; }],
    ['catalog reference', s => { s.lineItems[0].catalogItemId = 'catalog'; }], ['invoice number', s => { s.invoiceNumber = '1'; }],
    ['provider', s => { s.provider = 'provider'; }], ['line total', s => { s.lineItems[0].totalMinor++; }],
    ['missing line field', s => { delete s.lineItems[0].taxCode; }], ['extra customer field', s => { s.customer.extra = 'x'; }],
    ['unnormalized content', s => { s.customer.name = ' name '; }], ['bad created timestamp', s => { s.createdAt = 'bad'; }],
    ['map pretending timestamp', s => { s.updatedAt = { seconds: 102, nanoseconds: 0 }; }],
    ['backwards timestamp', s => { s.updatedAt = new Timestamp(99, 0); }]
]) test(`corruption ${label} is never repaired`, async () => {
    const stored = await current(); change(stored); await target().set(stored); await noWrite(args(minimal()), 'INTERNAL');
});
for (const lifecycleStatus of ['issued', 'cancelled', 'future_state']) test(`non-draft ${lifecycleStatus} is not editable`, async () => {
    await target().update({ lifecycleStatus }); await noWrite(args(), 'INVOICE_NOT_EDITABLE');
});
for (const field of ['revision', 'expectedRevision', 'ownerId', 'totals', 'lifecycleStatus', 'paymentStatus', 'createdAt', 'updatedBy']) test(`candidate ${field} rejected`, () => {
    return noWrite(args({ ...full(), [field]: 999 }), 'INVALID_INVOICE_DRAFT');
});
for (const field of ['ownerId', 'role', 'authContext', 'db']) test(`repository envelope ${field} rejected`, () => noWrite({ ...args(), [field]: 'injection' }, 'INVALID_REQUEST'));
for (const field of ['customerId', 'catalogItemId']) test(`candidate ${field} unsupported`, async () => {
    const input = full(); if (field === 'customerId') input.customerId = 'customer'; else input.lineItems[0].catalogItemId = 'catalog';
    await noWrite(args(input), 'REFERENCE_NOT_SUPPORTED');
});

// Force the real Firestore SDK to retry by aborting a complete first callback.
// Mutation happens only after that attempt is discarded, before retry reads.
for (const kind of ['none', 'membership', 'business', 'archived', 'owner', 'revision']) test(`SDK retry refreshes ${kind} without cached preparation`, async () => {
    const original = await current(); let attempts = 0; const reads = [];
    const operation = admin.db.runTransaction(async transaction => {
        attempts++; reads.push([]);
        if (attempts === 2) {
            if (kind === 'membership') await member().update({ active: false });
            if (kind === 'business') await business().update({ active: false });
            if (kind === 'archived') await business().update({ archived: true });
            if (kind === 'owner') await business().update({ ownerId: 'other' });
            if (kind === 'revision') await target().update({ revision: 2 });
        }
        const observed = {
            getAll(...refs) { reads.at(-1).push(...refs.map(ref => ref.path)); return transaction.getAll(...refs); },
            get(ref) { reads.at(-1).push(ref.path); return transaction.get(ref); },
            update(ref, values) { return transaction.update(ref, values); }
        };
        const result = await updateDraftInTransaction(observed, admin.db, args());
        if (attempts === 1) throw Object.assign(new Error('test-only abort'), { code: 10 });
        return result;
    }).catch(error => { throw safeUpdateError(error); });
    if (kind === 'none') {
        assert.deepEqual(await operation, { invoiceId: 'draft-1', revision: 2 }); assert.equal((await current()).revision, 2);
    } else {
        await expect(operation, kind === 'revision' ? 'INVOICE_REVISION_CONFLICT' : ['business', 'archived'].includes(kind) ? 'BUSINESS_INACTIVE' : 'BUSINESS_ACCESS_DENIED');
        assert.deepEqual(await current(), kind === 'revision' ? { ...original, revision: 2 } : original);
    }
    assert.equal(attempts, 2);
    for (const attemptReads of reads) assert.deepEqual(attemptReads.slice(0, 2), ['businesses/update-business', 'businesses/update-business/members/update-owner']);
    if (['none', 'revision'].includes(kind)) for (const attemptReads of reads) assert.equal(attemptReads[2], target().path);
});
test('exact transaction write mask excludes every protected field and all reads precede write', async () => {
    const calls = [];
    await admin.db.runTransaction(async transaction => {
        await updateDraftInTransaction({
            getAll(...refs) { calls.push('read'); return transaction.getAll(...refs); },
            get(ref) { calls.push('read'); return transaction.get(ref); },
            update(ref, values) {
                calls.push('write'); assert.equal(ref.path, target().path);
                assert.deepEqual(Object.keys(values).sort(), ['customer', 'currency', 'issueDate', 'dueDate', 'lineItems', 'subtotalMinor',
                    'discountMinor', 'taxMinor', 'totalMinor', 'balanceDueMinor', 'revision', 'updatedBy', 'updatedAt'].sort());
                return transaction.update(ref, values);
            }
        }, admin.db, args());
    });
    assert.deepEqual(calls, ['read', 'read', 'write']);
});
test('no authority, legacy or extra financial document writes', async () => {
    const b = (await business().get()).data(), m = (await member().get()).data();
    await admin.db.doc('invoices/legacy').set({ sentinel: true }); await admin.db.doc('payments/legacy').set({ sentinel: true });
    await update();
    assert.deepEqual((await business().get()).data(), b); assert.deepEqual((await member().get()).data(), m);
    for (const name of ['invoices', 'payments']) {
        const docs = await admin.db.collection(name).get(); assert.equal(docs.size, 1); assert.deepEqual(docs.docs[0].data(), { sentinel: true });
    }
    for (const name of ['financialEvents', 'counters', 'outbox', 'payments']) assert.equal((await business().collection(name).get()).empty, true);
    assert.deepEqual((await business().listCollections()).map(ref => ref.id).sort(), ['invoices', 'members']);
});
test('synchronous snapshot prevents caller mutation during transaction', async () => {
    const command = args(); const operation = update(command);
    command.expectedRevision = 999; command.verifiedUid = 'other'; command.input.customerName = 'changed'; command.input.lineItems[0].unitPriceMinor = 0;
    await operation; const stored = await current(); assert.equal(stored.customer.name, 'New customer'); assert.equal(stored.totalMinor, 1540);
});
test('unsafe request accessor is rejected without execution', async () => {
    const command = args(); let invoked = false; Object.defineProperty(command.input, 'customerName', { get() { invoked = true; return 'bad'; } });
    await noWrite(command, 'INVALID_REQUEST'); assert.equal(invoked, false);
});
for (const [code, mapped] of [[14, 'UNAVAILABLE'], [10, 'UNAVAILABLE'], [4, 'UNAVAILABLE'], [6, 'INTERNAL'], ['unknown', 'INTERNAL']]) test(`safe I/O mapping ${code}`, () => {
    const error = safeUpdateError(Object.assign(new Error('secret customer credentials'), { code, details: 'private' }));
    assert.equal(error.code, mapped); assert.equal(error.stack, undefined); assert.equal(error.cause, undefined);
    assert.doesNotMatch(JSON.stringify(error), /secret|private|credentials/);
});
test('closed repository fails without writes', async () => {
    const local = createEmulatorInvoiceDraftUpdateRepository(); await local.close();
    await expect(local.updateInvoiceDraftTransaction(args()), 'UNAVAILABLE');
});
test('remote hosts and real credential configuration fail before Admin initialization', () => {
    for (const [key, value] of [['FIRESTORE_EMULATOR_HOST', 'remote:8080'], ['FIREBASE_AUTH_EMULATOR_HOST', 'remote:9099'],
        ['GCLOUD_PROJECT', 'production'], ['GOOGLE_APPLICATION_CREDENTIALS', 'credential.json']]) {
        const original = process.env[key]; process.env[key] = value;
        try { assert.throws(() => createEmulatorInvoiceDraftUpdateRepository()); }
        finally { if (original === undefined) delete process.env[key]; else process.env[key] = original; }
    }
});
test('update repository stays local and callable uses a separate server boundary', async () => {
    const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url)));
    assert.ok(config.hosting.ignore.includes('tests/**'));
    const source = await readFile(new URL('../functions/src/index.js', import.meta.url), 'utf8');
    assert.match(source, /updateInvoiceDraft = onCall/);
    assert.doesNotMatch(source, /tests\//);
    assert.ok(config.hosting.ignore.includes('server/**'));
});
