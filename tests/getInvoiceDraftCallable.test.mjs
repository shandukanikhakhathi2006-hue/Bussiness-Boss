import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { Timestamp } from 'firebase-admin/firestore';
import { createEmulatorAdmin } from './server/emulatorAdmin.mjs';
import { assertFunctionsEmulatorEnvironment, demoProjectId, waitForFirestore } from './emulatorEnvironment.mjs';

import { readCallableError } from '../functions/src/getInvoiceDraft.js';
import { readDraftInTransaction, readInvoiceDraft } from '../server/invoiceDraftReadRepository.js';
import { validateInvoiceDraft } from '../js/finance/invoiceDraftValidator.js';
import { InvoiceDraftUpdatePersistenceError } from '../functions/node_modules/businessboss/server/invoiceDraftUpdateRepository.js';
import { SaveInvoiceDraftError } from '../functions/node_modules/businessboss/server/invoiceDraftBoundary.js';

let admin, owner, outsider, anonymous;
const clients = [];
const data = () => ({ businessId: 'read-callable-business', invoiceId: 'draft-1' });
const business = () => admin.db.doc('businesses/read-callable-business');
const member = () => business().collection('members').doc('read-callable-owner');
const target = () => business().collection('invoices').doc('draft-1');
const call = (payload = data(), client = owner) => client.invoke(payload);
async function client(uid) {
    const app = initializeApp({ projectId: demoProjectId, apiKey: 'emulator-only', authDomain: `${demoProjectId}.firebaseapp.com` }, `callable-${clients.length}`);
    const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const functions = getFunctions(app, 'africa-south1'); connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    const result = { app, auth, invoke: httpsCallable(functions, 'getInvoiceDraft', { timeout: 120000 }) }; clients.push(result);
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
    owner = await client('read-callable-owner'); outsider = await client('read-callable-outsider'); anonymous = await client();
});
beforeEach(async () => {
    const response = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${demoProjectId}/databases/(default)/documents`, { method: 'DELETE' });
    assert.equal(response.ok, true); await response.body?.cancel();
    await business().set({ ownerId: 'read-callable-owner', active: true });
    await member().set({ uid: 'read-callable-owner', role: 'owner', active: true });
    await target().set(initial());
});
after(async () => { await Promise.all(clients.map(({ app }) => deleteApp(app))); await admin?.close(); });

const candidate = () => ({ customerId: null, customerName: 'Customer 王', customerEmail: 'customer@example.test', customerAddress: 'Street\nCity',
    currency: 'ZAR', issueDate: '2026-09-01', dueDate: '2026-09-30', lineItems: [
        { id: 'b', description: 'Consulting', quantity: '1.500', unitPriceMinor: 1000, discountMinor: 100, taxRateBps: 1000, taxCode: 'STANDARD', catalogItemId: null },
        { id: 'a', description: 'Delivery', quantity: '2', unitPriceMinor: 500, discountMinor: 0, taxRateBps: 0, taxCode: 'ZERO', catalogItemId: null }
    ] });
const initial = () => {
    const draft = validateInvoiceDraft(candidate());
    return { schemaVersion: 2, businessId: 'read-callable-business', ownerId: 'read-callable-owner', lifecycleStatus: 'draft', paymentStatus: 'not_due', revision: 1,
        customer: { id: null, name: draft.customerName, email: draft.customerEmail, address: draft.customerAddress },
        currency: draft.currency, issueDate: draft.issueDate, dueDate: draft.dueDate, lineItems: draft.lineItems, ...draft.totals,
        amountPaidMinor: 0, balanceDueMinor: draft.totals.totalMinor, createdBy: 'historical-creator', updatedBy: 'historical-editor',
        createdAt: new Timestamp(100, 123), updatedAt: new Timestamp(101, 456) };
};
const current = async () => (await target().get()).data();
async function unchanged(operation, code, transport) {
    const before = await current(); await expect(operation(), code, transport); assert.deepEqual(await current(), before);
}


for (const revision of [1, 7, Number.MAX_SAFE_INTEGER]) test('owner reads validated draft at revision ' + revision + ' with exact response and no writes', async () => {
    await target().update({ revision }); const before = await target().get();
    assert.deepEqual((await call()).data, { invoiceId: 'draft-1', lifecycleStatus: 'draft', revision, draft: candidate(),
        totals: { subtotalMinor: 2500, discountMinor: 100, taxMinor: 140, totalMinor: 2540 } });
    const after = await target().get(); assert.deepEqual(after.data(), before.data()); assert.ok(after.updateTime.isEqual(before.updateTime));
});
test('invalid platform token rejected without sensitive error details', async () => {
    const before = await current();
    const response = await fetch('http://127.0.0.1:5001/' + demoProjectId + '/africa-south1/getInvoiceDraft', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer deliberately-invalid-token' }, body: JSON.stringify({ data: data() })
    });
    assert.equal(response.status, 401); const result = await response.json(); assert.equal(result.error.status, 'UNAUTHENTICATED');
    assert.doesNotMatch(JSON.stringify(result), /deliberately-invalid-token|read-callable-owner|stack|private/); assert.deepEqual(await current(), before);
});
test('unauthenticated read rejected', () => unchanged(() => call(data(), anonymous), 'UNAUTHENTICATED', 'unauthenticated'));
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
for (const field of ['businessId', 'invoiceId']) test('missing envelope field ' + field, async () => {
    const payload = data(); delete payload[field]; await unchanged(() => call(payload), 'INVALID_REQUEST', 'invalid-argument');
});
for (const payload of [null, [], 'text', 3, true, {}]) test('invalid envelope ' + JSON.stringify(payload), () => unchanged(() => call(payload), 'INVALID_REQUEST', 'invalid-argument'));
test('omitted callable data rejected', () => unchanged(() => owner.invoke(), 'INVALID_REQUEST', 'invalid-argument'));
for (const field of ['verifiedUid', 'uid', 'ownerId', 'actorUid', 'userId', 'memberUid', 'role', 'authContext', 'businessContext',
    'draft', 'input', 'expectedRevision', 'database', 'projectId', 'credentials', 'firebaseConfig', 'admin', 'transaction', 'prepared', 'serverTimestamp', 'totals', 'revision'])
    test('reject authority/internal envelope field ' + field, () => unchanged(() => call({ ...data(), [field]: 'other-user' }), 'INVALID_REQUEST', 'invalid-argument'));
for (const field of ['businessId', 'invoiceId']) for (const value of [null, 123, {}, [], '', '../other', '__reserved__', 'a'.repeat(129)])
    test('invalid route ' + field + ' ' + JSON.stringify(value), () => unchanged(() => call({ ...data(), [field]: value }), 'INVALID_REQUEST', 'invalid-argument'));

for (const lifecycleStatus of ['issued', 'cancelled', 'future_state']) test('noneditable lifecycle ' + lifecycleStatus, async () => {
    await target().update({ lifecycleStatus }); await unchanged(() => call(), 'INVOICE_NOT_EDITABLE', 'failed-precondition');
});
test('missing invoice never creates', async () => { await target().delete(); await unchanged(() => call(), 'INVOICE_NOT_FOUND', 'not-found'); assert.equal((await target().get()).exists, false); });
test('nonmember cannot discover missing target', async () => { await target().delete(); await unchanged(() => call(data(), outsider), 'BUSINESS_ACCESS_DENIED', 'permission-denied'); });
test('membership uid mismatch denied', async () => { await member().update({ uid: 'other' }); await unchanged(() => call(), 'BUSINESS_ACCESS_DENIED', 'permission-denied'); });
test('malformed business timezone denied', async () => { await business().update({ timezone: 'invalid-zone' }); await unchanged(() => call(), 'INTERNAL', 'internal'); });
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
    const stored = await current(); change(stored); await target().set(stored); const before = await target().get(); await unchanged(() => call(), 'INTERNAL', 'internal'); assert.ok((await target().get()).updateTime.isEqual(before.updateTime));
});

for (const revision of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null]) test('additional corrupt revision ' + revision, async () => {
    await target().update({ revision }); await unchanged(() => call(), 'INTERNAL', 'internal');
});
for (const field of ['createdBy', 'updatedBy']) test('invalid audit identity ' + field, async () => { await target().update({ [field]: '' }); await unchanged(() => call(), 'INTERNAL', 'internal'); });
test('safe error details exclude customer, owner, revision and SDK evidence', async () => {
    await target().update({ revision: 765432, provider: 'private-provider', customer: { id: null, name: 'private-customer', email: null, address: 'private-address' } });
    await assert.rejects(call(), error => { assert.deepEqual(error.details, { code: 'INTERNAL' });
        assert.doesNotMatch(JSON.stringify({ message: error.message, details: error.details }), /765432|private|owner|members|stack|Firestore|\.js/); return true; });
});
test('current membership is reloaded for each invocation', async () => { await call(); await member().update({ active: false }); await unchanged(() => call(), 'BUSINESS_ACCESS_DENIED', 'permission-denied'); });
test('real create → read → update → read → stale update workflow', async () => {
    await target().delete();
    const functions = getFunctions(owner.app, 'africa-south1'); const create = httpsCallable(functions, 'saveInvoiceDraft', { timeout: 120000 });
    const update = httpsCallable(functions, 'updateInvoiceDraft', { timeout: 120000 });
    assert.deepEqual((await create({ ...data(), draft: candidate() })).data, { invoiceId: 'draft-1', lifecycleStatus: 'draft' });
    const loaded = (await call()).data; assert.equal(loaded.revision, 1);
    loaded.draft.customerName = 'Changed';
    assert.deepEqual((await update({ ...data(), input: loaded.draft, expectedRevision: loaded.revision })).data, { invoiceId: 'draft-1', revision: 2 });
    const latest = (await call()).data; assert.equal(latest.revision, 2); assert.equal(latest.draft.customerName, 'Changed');
    await expect(update({ ...data(), input: loaded.draft, expectedRevision: 1 }), 'INVOICE_REVISION_CONFLICT', 'aborted');
    assert.deepEqual((await call()).data, latest);
    await expect(update({ ...data(), input: { ...latest.draft, totals: latest.totals }, expectedRevision: 2 }), 'INVALID_INVOICE_DRAFT', 'invalid-argument');
});
test('read does not touch authority, legacy, invoice or auxiliary documents', async () => {
    for (const name of ['invoices', 'payments']) await admin.db.doc(name + '/sentinel').set({ untouched: true });
    const refs = [business(), member(), target(), admin.db.doc('invoices/sentinel'), admin.db.doc('payments/sentinel')];
    const before = await admin.db.getAll(...refs); await call(); const after = await admin.db.getAll(...refs);
    before.forEach((snap, i) => { assert.deepEqual(after[i].data(), snap.data()); assert.ok(after[i].updateTime.isEqual(snap.updateTime)); });
    for (const name of ['financialEvents', 'counters', 'outbox']) assert.equal((await admin.db.collection(name).get()).empty, true);
    assert.deepEqual((await business().listCollections()).map(c => c.id).sort(), ['invoices', 'members']);
});
for (const state of ['disabled', 'deleted', 'revoked']) test(`callable re-verification rejects ${state} user with cached genuine token`, async () => {
    const uid = `read-callable-${state}`, session = await client(uid);
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


for (const kind of ['none', 'membership', 'business', 'archived', 'owner', 'revision']) test('real SDK read retry refreshes ' + kind + ' with zero writes', async () => {
    const before = await current(); let attempts = 0; const reads = [];
    const operation = admin.db.runTransaction(async transaction => {
        attempts++; reads.push([]);
        if (attempts === 2) {
            if (kind === 'membership') await member().update({ active: false });
            if (kind === 'business') await business().update({ active: false });
            if (kind === 'archived') await business().update({ archived: true });
            if (kind === 'owner') await business().update({ ownerId: 'other' });
            if (kind === 'revision') await target().update({ revision: 2 });
        }
        // Deliberately expose only read methods. Any callback write is a test failure.
        const observed = { getAll(...refs) { reads.at(-1).push(...refs.map(r => r.path)); return transaction.getAll(...refs); },
            get(ref) { reads.at(-1).push(ref.path); return transaction.get(ref); } };
        const result = await readDraftInTransaction(observed, admin.db, 'read-callable-owner', data(), () => {});
        if (attempts === 1) throw Object.assign(new Error('controlled test abort'), { code: 10 });
        return result;
    });
    if (['none', 'revision'].includes(kind)) assert.equal((await operation).revision, kind === 'revision' ? 2 : 1);
    else await assert.rejects(operation, error => error.code === (['business', 'archived'].includes(kind) ? 'BUSINESS_INACTIVE' : 'BUSINESS_ACCESS_DENIED'));
    assert.equal(attempts, 2);
    for (const attempt of reads) assert.deepEqual(attempt.slice(0, 2), [business().path, member().path]);
    if (['none', 'revision'].includes(kind)) for (const attempt of reads) assert.equal(attempt[2], target().path);
    assert.deepEqual(await current(), kind === 'revision' ? { ...before, revision: 2 } : before);
});
test('internal reader snapshots routing synchronously and uses default current transaction mode', async () => {
    const payload = data(); let options;
    const db = { collection: (...args) => admin.db.collection(...args), runTransaction: (callback, opts) => { options = opts; return admin.db.runTransaction(callback); } };
    const operation = readInvoiceDraft(db, 'read-callable-owner', payload, () => {}); payload.invoiceId = 'other';
    assert.equal((await operation).invoiceId, 'draft-1'); assert.equal(options, undefined);
});
test('internal reader rejects remote environment before reading', async () => {
    const saved = process.env.FIRESTORE_EMULATOR_HOST; process.env.FIRESTORE_EMULATOR_HOST = 'remote:8080';
    try { await assert.rejects(readInvoiceDraft(null, 'read-callable-owner', data(), () => {})); }
    finally { process.env.FIRESTORE_EMULATOR_HOST = saved; }
});
const mapping = { INVALID_REQUEST: 'invalid-argument', BUSINESS_ACCESS_DENIED: 'permission-denied', BUSINESS_NOT_FOUND: 'not-found',
    BUSINESS_INACTIVE: 'failed-precondition', INVALID_BUSINESS_ROLE: 'permission-denied', INVOICE_NOT_FOUND: 'not-found',
    INVOICE_NOT_EDITABLE: 'failed-precondition', UNAVAILABLE: 'unavailable', INTERNAL: 'internal' };
for (const [code, transport] of Object.entries(mapping)) test('stable read error mapping ' + code, () => {
    const error = readCallableError(new InvoiceDraftUpdatePersistenceError(code)); assert.equal(error.code, transport); assert.deepEqual(error.details, { code });
});
test('read authentication mapping', () => { const error = readCallableError(new SaveInvoiceDraftError('UNAUTHENTICATED')); assert.equal(error.code, 'unauthenticated'); assert.deepEqual(error.details, { code: 'UNAUTHENTICATED' }); });
for (const code of [14, 10, 4, 6, 'unknown']) test('safe read I/O mapping ' + code, () => {
    const error = readCallableError(Object.assign(new Error('private SDK path'), { code }));
    assert.deepEqual(error.details, { code: [14, 10, 4].includes(code) ? 'UNAVAILABLE' : 'INTERNAL' }); assert.doesNotMatch(error.message, /private|SDK|path/);
});
test('read package parity, v2 registration and pure helper reuse', async () => {
    for (const file of ['server/invoiceDraftReadRepository.js', 'js/backend/invoiceDraftUpdateCommand.js']) {
        const original = await readFile(new URL('../' + file, import.meta.url));
        const packaged = await readFile(new URL('../functions/node_modules/businessboss/' + file, import.meta.url)); assert.deepEqual(packaged, original);
        assert.doesNotMatch(packaged.toString(), /from ['"][^'"]*tests\/|private_key|BEGIN PRIVATE KEY|read-callable-owner|C:\\/);
    }
    const index = await readFile(new URL('../functions/src/index.js', import.meta.url), 'utf8'); assert.match(index, /getInvoiceDraft = onCall/);
    const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url))); assert.ok(config.hosting.ignore.includes('server/**'));
    const source = await readFile(new URL('../server/invoiceDraftReadRepository.js', import.meta.url), 'utf8');
    assert.match(source, /validateStoredInvoiceDraft\(evidence/); assert.doesNotMatch(source, /transaction\.(?:set|create|update|delete)\(/);
});
