import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { Timestamp } from 'firebase-admin/firestore';
import { createEmulatorAdmin } from './server/emulatorAdmin.mjs';
import { assertFunctionsEmulatorEnvironment, demoProjectId, waitForFirestore } from './emulatorEnvironment.mjs';

import { updateCallableError } from '../functions/src/updateInvoiceDraft.js';
import { InvoiceDraftUpdatePersistenceError } from '../functions/node_modules/businessboss/server/invoiceDraftUpdateRepository.js';
import { SaveInvoiceDraftError } from '../functions/node_modules/businessboss/server/invoiceDraftBoundary.js';

let admin, owner, outsider, anonymous;
const clients = [];
const minimal = () => ({ currency: 'ZAR', lineItems: [] });
const full = () => ({ customerId: null, customerName: ' Customer 王 ', customerEmail: null, customerAddress: ' Street\r\nCity ',
    currency: 'ZAR', issueDate: null, dueDate: null, lineItems: [{ id: 'line-1', description: ' Consulting ', quantity: '1.500',
        unitPriceMinor: 1000, discountMinor: 100, taxRateBps: 1000, taxCode: 'STANDARD', catalogItemId: null }] });
const data = (draft = minimal()) => ({ businessId: 'update-callable-business', invoiceId: 'draft-1', expectedRevision: 1, input: draft });
const business = () => admin.db.doc('businesses/update-callable-business');
const member = () => business().collection('members').doc('update-callable-owner');
const target = () => business().collection('invoices').doc('draft-1');
const call = (payload = data(), client = owner) => client.invoke(payload);
async function client(uid) {
    const app = initializeApp({ projectId: demoProjectId, apiKey: 'emulator-only', authDomain: `${demoProjectId}.firebaseapp.com` }, `callable-${clients.length}`);
    const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const functions = getFunctions(app, 'africa-south1'); connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    const result = { app, auth, invoke: httpsCallable(functions, 'updateInvoiceDraft', { timeout: 120000 }) }; clients.push(result);
    if (uid) {
        await admin.auth.createUser({ uid, email: `${uid}@example.test`, password: 'local-test-password' });
        await signInWithEmailAndPassword(auth, `${uid}@example.test`, 'local-test-password');
    }
    return result;
}
const expect = (promise, code, transport) => assert.rejects(promise, error => {
    assert.equal(error.code, `functions/${transport}`); assert.equal(error.details?.code, code);
    assert.equal(error.details.stack, undefined); assert.equal(error.details.cause, undefined); return true;
});
before(async () => {
    assertFunctionsEmulatorEnvironment(process.env); await waitForFirestore(); admin = createEmulatorAdmin();
    owner = await client('update-callable-owner'); outsider = await client('update-callable-outsider'); anonymous = await client();
});
beforeEach(async () => {
    const response = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${demoProjectId}/databases/(default)/documents`, { method: 'DELETE' });
    assert.equal(response.ok, true); await response.body?.cancel();
    await business().set({ ownerId: 'update-callable-owner', active: true });
    await member().set({ uid: 'update-callable-owner', role: 'owner', active: true });
    await target().set(initial());
});
after(async () => { await Promise.all(clients.map(({ app }) => deleteApp(app))); await admin?.close(); });

const initial = () => ({ schemaVersion: 2, businessId: 'update-callable-business', ownerId: 'update-callable-owner',
    lifecycleStatus: 'draft', paymentStatus: 'not_due', revision: 1,
    customer: { id: null, name: 'Old customer', email: null, address: null }, currency: 'ZAR', issueDate: null, dueDate: null,
    lineItems: [], subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0, amountPaidMinor: 0, balanceDueMinor: 0,
    createdBy: 'historical-creator', updatedBy: 'historical-editor', createdAt: new Timestamp(100, 123), updatedAt: new Timestamp(101, 456) });
const current = async () => (await target().get()).data();
async function unchanged(operation, code, transport) {
    const before = await current(); await expect(operation(), code, transport); assert.deepEqual(await current(), before);
}

test('actual update callable commits normalized replacement and exact safe response', async () => {
    const old = await current(); const result = await call(data(full()));
    assert.deepEqual(result.data, { invoiceId: 'draft-1', revision: 2 });
    const stored = await current();
    assert.deepEqual(stored.createdAt, old.createdAt); assert.equal(stored.createdBy, old.createdBy);
    assert.equal(stored.updatedBy, owner.auth.currentUser.uid); assert.ok(stored.updatedAt instanceof Timestamp);
    assert.ok(stored.updatedAt.seconds > old.updatedAt.seconds);
    assert.deepEqual(stored.customer, { id: null, name: 'Customer 王', email: null, address: 'Street\nCity' });
    assert.equal(stored.subtotalMinor, 1500); assert.equal(stored.discountMinor, 100); assert.equal(stored.taxMinor, 140);
    assert.equal(stored.totalMinor, 1540); assert.equal(stored.balanceDueMinor, 1540); assert.equal(stored.lineItems[0].totalMinor, 1540);
    for (const key of ['schemaVersion', 'ownerId', 'businessId', 'lifecycleStatus', 'paymentStatus', 'amountPaidMinor']) assert.deepEqual(stored[key], old[key]);
    assert.deepEqual(Object.keys(stored).sort(), Object.keys(old).sort());
});
test('revision five updates to six', async () => { await target().update({ revision: 5 }); assert.deepEqual((await call({ ...data(), expectedRevision: 5 })).data, { invoiceId: 'draft-1', revision: 6 }); });
test('minimal replacement clears content on second update', async () => {
    await call(data(full())); await call({ ...data(), expectedRevision: 2 }); const stored = await current();
    assert.equal(stored.revision, 3); assert.deepEqual(stored.lineItems, []); assert.equal(stored.totalMinor, 0); assert.equal(stored.customer.name, '');
});
test('unauthenticated update rejected', () => unchanged(() => call(data(), anonymous), 'UNAUTHENTICATED', 'unauthenticated'));
test('different tenant cannot impersonate owner', () => unchanged(() => call(data(), outsider), 'BUSINESS_ACCESS_DENIED', 'permission-denied'));
test('inactive membership rejected', async () => { await member().update({ active: false }); await unchanged(() => call(), 'BUSINESS_ACCESS_DENIED', 'permission-denied'); });
test('missing membership rejected', async () => { await member().delete(); await unchanged(() => call(), 'BUSINESS_ACCESS_DENIED', 'permission-denied'); });
for (const role of ['staff', 'accountant', 'viewer', 'Owner']) test('invalid write role ' + role, async () => {
    await member().update({ role }); await unchanged(() => call(), 'INVALID_BUSINESS_ROLE', 'permission-denied');
});
for (const [change, code, transport] of [[{ active: false }, 'BUSINESS_INACTIVE', 'failed-precondition'], [{ archived: true }, 'BUSINESS_INACTIVE', 'failed-precondition'],
    [{ ownerId: 'different-owner' }, 'BUSINESS_ACCESS_DENIED', 'permission-denied'], [{ active: 'true' }, 'INTERNAL', 'internal']]) test('business rejection ' + JSON.stringify(change), async () => {
    await business().update(change); await unchanged(() => call(), code, transport);
});
test('missing business with valid member', async () => { await business().delete(); await unchanged(() => call(), 'BUSINESS_NOT_FOUND', 'not-found'); });
test('nonmember cannot discover missing business', async () => { await business().delete(); await member().delete(); await unchanged(() => call(), 'BUSINESS_ACCESS_DENIED', 'permission-denied'); });
for (const field of ['businessId', 'invoiceId', 'expectedRevision', 'input']) test('missing envelope field ' + field, async () => {
    const payload = data(); delete payload[field]; await unchanged(() => call(payload), 'INVALID_REQUEST', 'invalid-argument');
});
for (const payload of [null, [], 'text', 3, true, {}]) test('invalid envelope ' + JSON.stringify(payload), () => unchanged(() => call(payload), 'INVALID_REQUEST', 'invalid-argument'));
test('omitted callable data rejected', () => unchanged(() => owner.invoke(), 'INVALID_REQUEST', 'invalid-argument'));
for (const field of ['verifiedUid', 'uid', 'ownerId', 'actorUid', 'userId', 'memberUid', 'role', 'authContext', 'businessContext',
    'database', 'projectId', 'credentials', 'firebaseConfig', 'admin', 'transaction', 'prepared', 'serverTimestamp', 'totals', 'revision'])
    test('reject authority/internal envelope field ' + field, () => unchanged(() => call({ ...data(), [field]: 'other-user' }), 'INVALID_REQUEST', 'invalid-argument'));
for (const field of ['businessId', 'invoiceId']) for (const value of [null, 123, {}, [], '', '../other', '__reserved__', 'a'.repeat(129)])
    test('invalid route ' + field + ' ' + JSON.stringify(value), () => unchanged(() => call({ ...data(), [field]: value }), 'INVALID_REQUEST', 'invalid-argument'));
for (const expectedRevision of [null, '1', true, {}, [], 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    test('invalid revision ' + JSON.stringify(expectedRevision), () => unchanged(() => call({ ...data(), expectedRevision }), 'INVALID_REQUEST', 'invalid-argument'));
for (const input of [null, [], 1, true, 'text']) test('invalid candidate shape ' + JSON.stringify(input), () => unchanged(() => call(data(input)), 'INVALID_REQUEST', 'invalid-argument'));
test('bounded payload rejected', () => unchanged(() => call(data({ ...minimal(), customerName: 'x'.repeat(513 * 1024) })), 'INVALID_REQUEST', 'invalid-argument'));
test('nested candidate beyond traversal limit rejected', () => { let value = {}; for (let i = 0; i < 18; i++) value = { nested: value }; return unchanged(() => call(data(value)), 'INVALID_REQUEST', 'invalid-argument'); });
for (const field of ['totals', 'createdAt', 'ownerId', 'verifiedUid', 'provider', 'revision']) test('candidate injection ' + field, () =>
    unchanged(() => call(data({ ...minimal(), [field]: 'private-value' })), 'INVALID_INVOICE_DRAFT', 'invalid-argument'));
test('draft validator details sanitized', async () => { await assert.rejects(call(data({ currency: 'private-currency', lineItems: [] })), error => {
    assert.deepEqual(error.details, { code: 'INVALID_INVOICE_DRAFT', domainCode: 'INVALID_CURRENCY', path: 'currency' }); return true;
}); });
test('linked reference retains existing domain policy', () => unchanged(() => call(data({ ...minimal(), customerId: 'customer-1' })), 'REFERENCE_NOT_SUPPORTED', 'failed-precondition'));
test('stale expectedRevision never rebased', async () => { await target().update({ revision: 6 }); await unchanged(() => call({ ...data(full()), expectedRevision: 5 }), 'INVOICE_REVISION_CONFLICT', 'aborted'); });
test('two concurrent callable updates have exactly one winner', async () => {
    await target().update({ revision: 10 });
    const results = await Promise.allSettled(['A', 'B'].map(customerName => call({ ...data({ ...full(), customerName }), expectedRevision: 10 })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); const winner = results.findIndex(r => r.status === 'fulfilled');
    assert.deepEqual(results[winner].value.data, { invoiceId: 'draft-1', revision: 11 });
    assert.equal(results[1 - winner].reason.code, 'functions/aborted'); assert.deepEqual(results[1 - winner].reason.details, { code: 'INVOICE_REVISION_CONFLICT' });
    const stored = await current(); assert.equal(stored.revision, 11); assert.equal(stored.customer.name, ['A', 'B'][winner]); assert.equal(stored.totalMinor, 1540);
});
for (const lifecycleStatus of ['issued', 'cancelled']) test('noneditable lifecycle ' + lifecycleStatus, async () => { await target().update({ lifecycleStatus }); await unchanged(() => call(), 'INVOICE_NOT_EDITABLE', 'failed-precondition'); });
for (const change of [{ totalMinor: 99 }, { revision: '1' }, { schemaVersion: 1 }, { provider: 'private-provider' }, { createdAt: { seconds: 100, nanoseconds: 123 } }])
    test('stored corruption ' + JSON.stringify(change), async () => { await target().update(change); await unchanged(() => call(), 'INTERNAL', 'internal'); });
test('missing invoice does not upsert', async () => { await target().delete(); await unchanged(() => call(), 'INVOICE_NOT_FOUND', 'not-found'); assert.equal((await target().get()).exists, false); });
test('unauthorized caller cannot disclose missing target', async () => { await target().delete(); await unchanged(() => call(data(), outsider), 'BUSINESS_ACCESS_DENIED', 'permission-denied'); });
test('wire errors contain only safe contract fields', async () => {
    await target().update({ revision: 987654, customer: { id: null, name: 'private-customer', email: null, address: 'private-address' } });
    await assert.rejects(call(), error => {
        assert.deepEqual(error.details, { code: 'INVOICE_REVISION_CONFLICT' });
        assert.doesNotMatch(JSON.stringify({ message: error.message, details: error.details }), /987654|private|Firestore|stack|owner|members|C:\\|.js/); return true;
    });
});
test('no legacy or auxiliary writes', async () => {
    await admin.db.doc('invoices/sentinel').set({ unchanged: true }); await admin.db.doc('payments/sentinel').set({ unchanged: true });
    const beforeBusiness = (await business().get()).data(), beforeMember = (await member().get()).data(); await call();
    assert.deepEqual((await business().get()).data(), beforeBusiness); assert.deepEqual((await member().get()).data(), beforeMember);
    for (const name of ['invoices', 'payments']) { const docs = await admin.db.collection(name).get(); assert.equal(docs.size, 1); assert.deepEqual(docs.docs[0].data(), { unchanged: true }); }
    assert.deepEqual((await business().listCollections()).map(c => c.id).sort(), ['invoices', 'members']);
    for (const name of ['financialEvents', 'counters', 'outbox']) assert.equal((await admin.db.collection(name).get()).empty, true);
});
for (const state of ['disabled', 'deleted', 'revoked']) test(`callable re-verification rejects ${state} user with cached genuine token`, async () => {
    const uid = `update-callable-${state}`, session = await client(uid);
    const issued = await session.auth.currentUser.getIdToken();
    if (state === 'disabled') await admin.auth.updateUser(uid, { disabled: true });
    if (state === 'deleted') await admin.auth.deleteUser(uid);
    if (state === 'revoked') {
        await admin.auth.revokeRefreshTokens(uid);
        const authTime = JSON.parse(Buffer.from(issued.split('.')[1], 'base64url')).auth_time;
        // Deterministic emulator fixture: advance the authoritative revocation
        // threshold instead of sleeping or modifying the real client-issued token.
        const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${demoProjectId}/accounts:update`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
            body: JSON.stringify({ localId: uid, validSince: String(authTime + 60) })
        });
        assert.equal(response.ok, true); await response.body?.cancel();
        assert.ok(Date.parse((await admin.auth.getUser(uid)).tokensValidAfterTime) > authTime * 1000);
    }
    assert.equal(await session.auth.currentUser.getIdToken(), issued);
    await expect(call(data(), session), 'UNAUTHENTICATED', 'unauthenticated');
});

const mapping = { INVALID_REQUEST: 'invalid-argument', INVALID_INVOICE_DRAFT: 'invalid-argument', REFERENCE_NOT_SUPPORTED: 'failed-precondition',
    BUSINESS_ACCESS_DENIED: 'permission-denied', BUSINESS_NOT_FOUND: 'not-found', BUSINESS_INACTIVE: 'failed-precondition', INVALID_BUSINESS_ROLE: 'permission-denied',
    INVOICE_NOT_FOUND: 'not-found', INVOICE_NOT_EDITABLE: 'failed-precondition', INVOICE_REVISION_CONFLICT: 'aborted', UNAVAILABLE: 'unavailable', INTERNAL: 'internal' };
for (const [code, transport] of Object.entries(mapping)) test('update error mapping ' + code, () => {
    const error = updateCallableError(new InvoiceDraftUpdatePersistenceError(code)); assert.equal(error.code, transport); assert.deepEqual(error.details, { code });
});
test('authentication mapping remains stable', () => { const error = updateCallableError(new SaveInvoiceDraftError('UNAUTHENTICATED')); assert.equal(error.code, 'unauthenticated'); assert.deepEqual(error.details, { code: 'UNAUTHENTICATED' }); });
test('raw SDK failure never leaks', () => { const error = updateCallableError(new Error('private credential path')); assert.equal(error.code, 'internal'); assert.deepEqual(error.details, { code: 'INTERNAL' }); assert.doesNotMatch(error.message, /private|credential|path/); });
test('packaged update sources match canonical source without test or credential dependencies', async () => {
    for (const file of ['server/invoiceDraftUpdateRepository.js', 'js/backend/invoiceDraftUpdateCommand.js']) {
        const canonical = await readFile(new URL('../' + file, import.meta.url));
        const packaged = await readFile(new URL('../functions/node_modules/businessboss/' + file, import.meta.url));
        assert.deepEqual(packaged, canonical); assert.doesNotMatch(packaged.toString(), /from ['"][^'"]*tests\/|BEGIN PRIVATE KEY|emulator@example|private_key|C:\\|historical-creator|update-callable-owner/);
    }
    const source = await readFile(new URL('../functions/src/updateInvoiceDraft.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"][^'"]*tests\/|BEGIN PRIVATE KEY|private_key|C:\\/);
    assert.match(source, /verifiedUid = request.auth.uid/);
    const index = await readFile(new URL('../functions/src/index.js', import.meta.url), 'utf8');
    assert.match(index, /updateInvoiceDraft = onCall/); assert.match(index, /saveInvoiceDraft = onCall/);
});

test('installed shared package contains exactly the reviewed modules', async () => {
    const base = new URL('../functions/node_modules/businessboss/', import.meta.url);
    const files = [];
    async function walk(prefix = '') {
        for (const item of await readdir(new URL(prefix, base), { withFileTypes: true })) {
            const name = prefix + item.name;
            if (item.isDirectory()) await walk(name + '/'); else files.push(name);
        }
    }
    await walk();
    assert.deepEqual(files.sort(), ['package.json', 'js/backend/invoiceDraftCommand.js', 'js/backend/invoiceDraftUpdateCommand.js',
        'js/finance/invoiceCalculations.js', 'js/finance/invoiceDraftValidator.js', 'server/invoiceDraftBoundary.js',
        'server/invoiceDraftRepository.js', 'server/invoiceDraftUpdateRepository.js', 'server/invoiceDraftReadRepository.js', 'server/emulatorSafety.js'].sort());
});
