import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, Timestamp, setLogLevel } from 'firebase/firestore';
import { authorizeAndPrepareInvoiceDraftCommand as prepare } from '../js/backend/invoiceDraftCommand.js';
import { createEmulatorInvoiceDraftPersistence, InvoiceDraftPersistenceError } from '../js/backend/invoiceDraftPersistence.js';
import { assertEmulatorEnvironment, demoProjectId, waitForFirestore } from './emulatorEnvironment.mjs';

assertEmulatorEnvironment(process.env);
let environment;
let persistence;
const minimal = () => ({ currency: 'ZAR', lineItems: [] });
const full = () => ({
    customerId: ' customer-1 ', customerName: ' Customer 王 ', customerEmail: ' customer@example.test ',
    customerAddress: ' Street\r\nCity ', currency: 'ZAR', issueDate: '2026-09-08', dueDate: '2026-09-30',
    lineItems: [{ id: 'line-1', description: ' Consulting ', quantity: '1.500', unitPriceMinor: 1000,
        discountMinor: 100, taxRateBps: 1000, taxCode: 'STANDARD', catalogItemId: null }]
});
const request = (input = full(), businessId = 'business-a', uid = 'user-a') => ({
    authContext: { uid }, businessContext: { businessId, ownerId: uid, role: 'owner' }, input
});
const save = (preparedCommand = prepare(request()), invoiceId = 'draft-1') => persistence.saveInvoiceDraft({ preparedCommand, invoiceId });
const submit = async (input, invoiceId = 'draft-1') => save(prepare(request(input)), invoiceId);
const admin = async callback => {
    let result;
    await environment.withSecurityRulesDisabled(async context => { result = await callback(context.firestore()); });
    return result;
};
const read = (invoiceId = 'draft-1', businessId = 'business-a') => admin(async db => (await getDoc(doc(db, 'businesses', businessId, 'invoices', invoiceId))).data());
const code = expected => error => error instanceof InvoiceDraftPersistenceError && error.code === expected;
const withoutTimes = data => { const { createdAt, updatedAt, ...rest } = data; return rest; };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

before(async () => {
    await waitForFirestore();
    environment = await initializeTestEnvironment({ projectId: demoProjectId,
        firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
    persistence = await createEmulatorInvoiceDraftPersistence();
    setLogLevel('silent');
});
beforeEach(async () => { await environment.clearFirestore(); });
after(async () => { await persistence?.close(); await environment?.cleanup(); });

test('authorized full draft stores exactly the selected v2 schema and calculated financial values', async () => {
    assert.deepEqual(await save(), { invoiceId: 'draft-1', path: 'businesses/business-a/invoices/draft-1' });
    assert.deepEqual(withoutTimes(await read()), {
        schemaVersion: 2, businessId: 'business-a', ownerId: 'user-a', lifecycleStatus: 'draft', paymentStatus: 'not_due',
        customer: { id: 'customer-1', name: 'Customer 王', email: 'customer@example.test', address: 'Street\nCity' },
        currency: 'ZAR', issueDate: '2026-09-08', dueDate: '2026-09-30',
        lineItems: [{ id: 'line-1', description: 'Consulting', quantity: '1.500', unitPriceMinor: 1000,
            discountMinor: 100, taxRateBps: 1000, taxCode: 'STANDARD', catalogItemId: null,
            subtotalMinor: 1500, taxMinor: 140, totalMinor: 1540 }],
        subtotalMinor: 1500, discountMinor: 100, taxMinor: 140, totalMinor: 1540,
        amountPaidMinor: 0, balanceDueMinor: 1540, createdBy: 'user-a', updatedBy: 'user-a'
    });
});
test('minimal incomplete draft persists with null dates, empty customer and zero totals', async () => {
    await submit(minimal());
    const data = await read();
    assert.deepEqual(data.customer, { id: null, name: '', email: null, address: null });
    assert.equal(data.issueDate, null); assert.equal(data.dueDate, null);
    assert.deepEqual(data.lineItems, []);
    for (const field of ['subtotalMinor', 'discountMinor', 'taxMinor', 'totalMinor', 'amountPaidMinor', 'balanceDueMinor']) assert.equal(data[field], 0);
    assert.equal(data.lifecycleStatus, 'draft'); assert.equal(data.paymentStatus, 'not_due');
});
test('identity and attribution come from the trusted preparation result', async () => {
    const command = prepare(request(full(), 'business-b', 'owner-b'));
    await save(command);
    const data = await read('draft-1', 'business-b');
    assert.equal(data.businessId, command.businessId); assert.equal(data.ownerId, command.ownerId);
    assert.equal(data.createdBy, command.actorUid); assert.equal(data.updatedBy, command.actorUid);
    assert.equal(await read(), undefined);
});
test('draft has no numbering, legacy status, issuance or provider metadata', async () => {
    await save();
    const data = await read();
    for (const field of ['invoiceNumber', 'status', 'issuedAt', 'sentAt', 'paidAt', 'cancelledAt', 'provider',
        'paymentReference', 'providerTransactionId', 'verifiedAt', 'paymentId', 'revision']) assert.equal(Object.hasOwn(data, field), false, field);
});
test('both timestamp transforms resolve to the same server commit timestamp', async () => {
    await save();
    const data = await read();
    assert.ok(data.createdAt instanceof Timestamp); assert.ok(data.updatedAt instanceof Timestamp);
    assert.ok(data.createdAt.seconds > 0); assert.ok(data.createdAt.isEqual(data.updatedAt));
});
for (const field of ['createdAt', 'updatedAt', 'totalMinor', 'subtotalMinor', 'balanceDueMinor', 'businessId', 'ownerId', 'createdBy', 'updatedBy']) {
    test(`raw client ${field} injection fails in preparation before persistence`, async () => {
        let reachedPersistence = false;
        await assert.rejects(async () => {
            const preparedCommand = prepare(request({ ...minimal(), [field]: field.endsWith('At') ? Timestamp.fromMillis(1) : 999 }));
            reachedPersistence = true;
            await save(preparedCommand);
        }, error => error.code === 'UNKNOWN_DRAFT_FIELD');
        assert.equal(reachedPersistence, false); assert.equal(await read(), undefined);
    });
}
test('duplicate ID rejects without changing the existing document or its timestamps', async () => {
    await save(); const original = await read();
    await assert.rejects(save(prepare(request(minimal()))), code('INVOICE_ALREADY_EXISTS'));
    assert.deepEqual(await read(), original);
});
test('concurrent creates of one ID have exactly one winner', async () => {
    const first = prepare(request(full())); const second = prepare(request(minimal()));
    const results = await Promise.allSettled([save(first), save(second)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.ok(code('INVOICE_ALREADY_EXISTS')(rejected.reason));
    const winner = results[0].status === 'fulfilled' ? first : second;
    assert.equal((await read()).totalMinor, winner.draft.totals.totalMinor);
});
const malformed = [
    ['null', () => null], ['array', () => []], ['raw input', () => full()],
    ['missing identity', command => { delete command.ownerId; return command; }],
    ['unknown metadata', command => ({ ...command, paidAt: 1 })],
    ['missing totals', command => { delete command.draft.totals; return command; }],
    ['wrong customer type', command => { command.draft.customerName = {}; return command; }],
    ['wrong total type', command => { command.draft.totals.totalMinor = '1540'; return command; }],
    ['unsafe total', command => { command.draft.totals.totalMinor = Number.MAX_SAFE_INTEGER + 1; return command; }],
    ['line metadata', command => { command.draft.lineItems[0].provider = 'forged'; return command; }],
    ['sparse lines', command => { command.draft.lineItems = new Array(1); return command; }],
    ['accessor', command => { Object.defineProperty(command, 'draft', { get() { assert.fail('getter must not run'); } }); return command; }]
];
for (const [label, change] of malformed) test(`rejects malformed prepared storage contract: ${label}`, async () => {
    await assert.rejects(save(change(prepare(request()))), code('INVALID_PREPARED_COMMAND'));
    assert.equal(await read(), undefined);
});
for (const businessId of ['../', 'business/other', '.', '..']) test(`preparation prevents business path escape: ${businessId}`, async () => {
    let reachedPersistence = false;
    await assert.rejects(async () => {
        const command = prepare(request(full(), businessId));
        reachedPersistence = true; await save(command);
    }, error => error.code === 'INVALID_BUSINESS_CONTEXT');
    assert.equal(reachedPersistence, false); assert.equal(await read(), undefined);
});
for (const invoiceId of ['', '../', 'invoice/other', '.', '..', '__reserved__', 'x'.repeat(1501)]) {
    test(`adapter rejects invalid invoice path segment (${invoiceId.length > 20 ? 'too long' : invoiceId})`, async () => {
        await assert.rejects(save(prepare(request()), invoiceId), code('INVALID_DOCUMENT_PATH'));
        assert.equal(await read(), undefined);
    });
}
test('adapter also defends the business path in a forged prepared object', async () => {
    await assert.rejects(save({ ...prepare(request()), businessId: 'business/other' }), code('INVALID_DOCUMENT_PATH'));
    assert.equal(await read(), undefined);
});
test('same invoice ID remains isolated across businesses', async () => {
    await save(prepare(request(full(), 'business-a')));
    await save(prepare(request(minimal(), 'business-b', 'user-b')));
    assert.equal((await read()).totalMinor, 1540);
    assert.equal((await read('draft-1', 'business-b')).totalMinor, 0);
    assert.equal((await read('draft-1', 'business-b')).ownerId, 'user-b');
});
test('legacy invoices/payments and unrelated v2 collections remain untouched', async () => {
    await admin(async db => {
        await setDoc(doc(db, 'invoices', 'legacy'), { ownerId: 'legacy-owner', status: 'pending' });
        await setDoc(doc(db, 'payments', 'legacy'), { amount: 20 });
    });
    await save();
    await admin(async db => {
        for (const [name, expected] of [['invoices', { ownerId: 'legacy-owner', status: 'pending' }], ['payments', { amount: 20 }]]) {
            const snapshots = await getDocs(collection(db, name));
            assert.equal(snapshots.size, 1); assert.deepEqual(snapshots.docs[0].data(), expected);
        }
        assert.equal((await getDoc(doc(db, 'businesses', 'business-a'))).exists(), false);
        for (const name of ['payments', 'financialEvents', 'counters', 'refunds', 'outbox', 'memberships', 'members']) {
            assert.equal((await getDocs(collection(db, 'businesses', 'business-a', name))).empty, true);
        }
    });
});
test('deeply frozen prepared command and nested line items remain unchanged', async () => {
    const command = freeze(prepare(request())); const before = structuredClone(command);
    await save(command); assert.deepEqual(command, before);
});
test('caller mutation after save starts cannot alter the stored snapshot', async () => {
    const command = prepare(request()); const pending = save(command);
    command.draft.lineItems[0].description = 'changed'; command.draft.totals.totalMinor = 1;
    await pending;
    const data = await read(); assert.equal(data.totalMinor, 1540); assert.equal(data.lineItems[0].description, 'Consulting');
});
test('same prepared draft and different IDs store equivalent financial contents', async () => {
    const command = prepare(request()); await save(command, 'one'); await save(command, 'two');
    assert.deepEqual(withoutTimes(await read('one')), withoutTimes(await read('two')));
});
for (const uid of ['user-a', 'user-b', null]) test(`unchanged rules deny all direct v2 access for ${uid ?? 'guest'}`, async () => {
    await save();
    const db = uid ? environment.authenticatedContext(uid).firestore() : environment.unauthenticatedContext().firestore();
    const target = doc(db, 'businesses/business-a/invoices/draft-1');
    await assertFails(getDoc(target)); await assertFails(updateDoc(target, { totalMinor: 1 }));
    await assertFails(deleteDoc(target));
    await assertFails(setDoc(doc(db, 'businesses/business-a/invoices/forged'), { ownerId: uid, lifecycleStatus: 'draft' }));
    assert.equal((await read()).totalMinor, 1540);
});
for (const [key, value] of [['FIRESTORE_EMULATOR_HOST', undefined], ['FIRESTORE_EMULATOR_HOST', 'firestore.googleapis.com:443'],
    ['FIRESTORE_EMULATOR_HOST', '127.0.0.1:9090'], ['GCLOUD_PROJECT', 'production-project'],
    ['GOOGLE_CLOUD_PROJECT', 'production-project'], ['FIREBASE_CONFIG', '{"projectId":"production-project"}']]) {
    test(`factory and save fail closed for unsafe ${key}=${value}`, async () => {
        const original = process.env[key];
        try {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
            await assert.rejects(createEmulatorInvoiceDraftPersistence());
            await assert.rejects(save());
        } finally { if (original === undefined) delete process.env[key]; else process.env[key] = original; }
        assert.equal(await read(), undefined);
    });
}
test('closed adapter cannot save', async () => {
    const adapter = await createEmulatorInvoiceDraftPersistence(); await adapter.close();
    await assert.rejects(adapter.saveInvoiceDraft({ preparedCommand: prepare(request()), invoiceId: 'closed' }), code('ADAPTER_CLOSED'));
    assert.equal(await read('closed'), undefined);
});
