import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { Timestamp } from 'firebase-admin/firestore';
import { createEmulatorAdmin } from './server/emulatorAdmin.mjs';
import { assertFunctionsEmulatorEnvironment, demoProjectId, waitForFirestore } from './emulatorEnvironment.mjs';
import { callableOptions, assertLocalFunctionsEnvironment } from '../functions/src/localEnvironment.js';
import { callableError } from '../functions/src/saveInvoiceDraft.js';
import { SaveInvoiceDraftError } from '../functions/node_modules/businessboss/server/invoiceDraftBoundary.js';

let admin, owner, outsider, anonymous;
const clients = [];
const minimal = () => ({ currency: 'ZAR', lineItems: [] });
const full = () => ({ customerId: null, customerName: ' Customer 王 ', customerEmail: null, customerAddress: ' Street\r\nCity ',
    currency: 'ZAR', issueDate: null, dueDate: null, lineItems: [{ id: 'line-1', description: ' Consulting ', quantity: '1.500',
        unitPriceMinor: 1000, discountMinor: 100, taxRateBps: 1000, taxCode: 'STANDARD', catalogItemId: null }] });
const data = (draft = minimal()) => ({ businessId: 'callable-business', invoiceId: 'draft-1', draft });
const business = () => admin.db.doc('businesses/callable-business');
const member = () => business().collection('members').doc('callable-owner');
const target = () => business().collection('invoices').doc('draft-1');
const call = (payload = data(), client = owner) => client.invoke(payload);
async function client(uid) {
    const app = initializeApp({ projectId: demoProjectId, apiKey: 'emulator-only', authDomain: `${demoProjectId}.firebaseapp.com` }, `callable-${clients.length}`);
    const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const functions = getFunctions(app, 'africa-south1'); connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    const result = { app, auth, invoke: httpsCallable(functions, 'saveInvoiceDraft', { timeout: 120000 }) }; clients.push(result);
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
    owner = await client('callable-owner'); outsider = await client('callable-outsider'); anonymous = await client();
});
beforeEach(async () => {
    const response = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${demoProjectId}/databases/(default)/documents`, { method: 'DELETE' });
    assert.equal(response.ok, true); await response.body?.cancel();
    await business().set({ ownerId: 'callable-owner', active: true });
    await member().set({ uid: 'callable-owner', role: 'owner', active: true });
});
after(async () => { await Promise.all(clients.map(({ app }) => deleteApp(app))); await admin?.close(); });

test('actual client Auth → httpsCallable → Functions Emulator saves minimal draft with exact response', async () => {
    const payload = data(); assert.equal(Object.hasOwn(payload, 'idToken'), false);
    assert.equal(owner.auth.currentUser.uid, 'callable-owner');
    const result = await call(payload); assert.deepEqual(result.data, { invoiceId: 'draft-1', lifecycleStatus: 'draft' });
    const stored = (await target().get()).data();
    assert.ok(stored.createdAt instanceof Timestamp); assert.ok(stored.updatedAt instanceof Timestamp);
    assert.ok(stored.createdAt.isEqual(stored.updatedAt));
    const { createdAt, updatedAt, ...fields } = stored;
    assert.deepEqual(fields, { schemaVersion: 2, businessId: 'callable-business', ownerId: 'callable-owner', lifecycleStatus: 'draft', paymentStatus: 'not_due',
        customer: { id: null, name: '', email: null, address: null }, currency: 'ZAR', issueDate: null, dueDate: null, lineItems: [],
        subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0, amountPaidMinor: 0, balanceDueMinor: 0,
        createdBy: 'callable-owner', updatedBy: 'callable-owner' });
});
test('full callable draft has normalized snapshots and server-calculated amounts', async () => {
    await call(data(full())); const stored = (await target().get()).data();
    assert.equal(stored.customer.name, 'Customer 王'); assert.equal(stored.customer.address, 'Street\nCity');
    assert.equal(stored.subtotalMinor, 1500); assert.equal(stored.discountMinor, 100); assert.equal(stored.taxMinor, 140);
    assert.equal(stored.totalMinor, 1540); assert.equal(stored.balanceDueMinor, 1540);
    assert.equal(stored.lineItems[0].totalMinor, 1540);
    for (const field of ['invoiceNumber', 'revision', 'provider', 'paymentReference', 'issuedAt', 'paidAt']) assert.equal(Object.hasOwn(stored, field), false);
});
test('missing Auth is a safe unauthenticated callable error', () => expect(call(data(), anonymous), 'UNAUTHENTICATED', 'unauthenticated'));
test('another authenticated user cannot impersonate owner', () => expect(call(data(), outsider), 'BUSINESS_ACCESS_DENIED', 'permission-denied'));
for (const field of ['idToken', 'uid', 'ownerId', 'role', 'active', 'actorUid', 'authContext', 'businessContext', 'totals', 'createdAt', 'provider', 'paymentStatus'])
    test(`callable envelope rejects ${field} injection`, () => expect(call({ ...data(), [field]: 'private-injection' }), 'INVALID_REQUEST', 'invalid-argument'));
test('nested application data wrapper is rejected', () => expect(call({ data: data() }), 'INVALID_REQUEST', 'invalid-argument'));
test('owner without membership denied', async () => { await member().delete(); await expect(call(), 'BUSINESS_ACCESS_DENIED', 'permission-denied'); });
for (const role of ['staff', 'accountant', 'viewer', 'Owner']) test(`callable ${role} write denied`, async () => {
    await member().update({ role }); await expect(call(), 'INVALID_BUSINESS_ROLE', 'permission-denied');
});
for (const [label, change] of [['inactive', { active: false }], ['uid mismatch', { uid: 'callable-outsider' }]]) test(`callable membership ${label} denied`, async () => {
    await member().update(change); await expect(call(), 'BUSINESS_ACCESS_DENIED', 'permission-denied');
});
for (const [label, change, code, transport] of [
    ['inactive', { active: false }, 'BUSINESS_INACTIVE', 'failed-precondition'], ['archived', { archived: true }, 'BUSINESS_INACTIVE', 'failed-precondition'],
    ['owner mismatch', { ownerId: 'callable-outsider' }, 'BUSINESS_ACCESS_DENIED', 'permission-denied'], ['malformed', { active: 'true' }, 'INTERNAL', 'internal']])
    test(`callable business ${label} denied`, async () => { await business().update(change); await expect(call(), code, transport); });
test('non-member cannot discover missing business', async () => { await business().delete(); await member().delete(); await expect(call(), 'BUSINESS_ACCESS_DENIED', 'permission-denied'); });
test('active member can receive business not-found', async () => { await business().delete(); await expect(call(), 'BUSINESS_NOT_FOUND', 'not-found'); });
test('invalid draft exposes only approved validation code and field', async () => {
    await assert.rejects(call(data({ currency: 'private-currency', lineItems: [] })), error => {
        assert.equal(error.code, 'functions/invalid-argument'); assert.deepEqual(error.details,
            { code: 'INVALID_INVOICE_DRAFT', domainCode: 'INVALID_CURRENCY', path: 'currency' }); return true;
    });
});
test('arithmetic validation maps safely through callable', async () => { const draft = full(); draft.lineItems[0].unitPriceMinor = -1; await expect(call(data(draft)), 'INVALID_INVOICE_DRAFT', 'invalid-argument'); });
for (const field of ['totals', 'lifecycleStatus', 'createdAt', 'provider']) test(`draft ${field} injection rejected`, () =>
    expect(call(data({ ...minimal(), [field]: 'private-injection' })), 'INVALID_INVOICE_DRAFT', 'invalid-argument'));
for (const field of ['customerId', 'catalogItemId']) test(`callable ${field} reference unsupported`, async () => {
    const draft = full(); if (field === 'customerId') draft.customerId = 'customer-a'; else draft.lineItems[0].catalogItemId = 'item-a';
    await expect(call(data(draft)), 'REFERENCE_NOT_SUPPORTED', 'failed-precondition');
});
for (const changed of [false, true]) test(`duplicate ${changed ? 'changed' : 'same'} payload preserves complete original`, async () => {
    await call(); const original = (await target().get()).data(); await expect(call(data(changed ? full() : minimal())), 'INVOICE_ALREADY_EXISTS', 'already-exists');
    assert.deepEqual((await target().get()).data(), original);
});
test('concurrent callable creates produce one winner and one conflict', async () => {
    const results = await Promise.allSettled([call(), call()]); assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(results.find(item => item.status === 'rejected').reason.code, 'functions/already-exists');
});
test('callable cannot disclose conflict before authorization', async () => { await call(); await expect(call(data(), outsider), 'BUSINESS_ACCESS_DENIED', 'permission-denied'); });
test('no legacy financial writes, tenant changes or extra financial documents', async () => {
    await admin.db.doc('invoices/sentinel').set({ unchanged: true }); await admin.db.doc('payments/sentinel').set({ unchanged: true });
    const businessBefore = (await business().get()).data(), memberBefore = (await member().get()).data();
    await call(); assert.deepEqual((await business().get()).data(), businessBefore); assert.deepEqual((await member().get()).data(), memberBefore);
    for (const collection of ['invoices', 'payments']) { const docs = await admin.db.collection(collection).get(); assert.equal(docs.size, 1); assert.deepEqual(docs.docs[0].data(), { unchanged: true }); }
    for (const collection of ['financialEvents', 'counters', 'outbox', 'payments']) {
        assert.equal((await business().collection(collection).get()).empty, true);
        if (collection !== 'payments') assert.equal((await admin.db.collection(collection).get()).empty, true);
    }
    assert.deepEqual((await business().listCollections()).map(item => item.id).sort(), ['invoices', 'members']);
});
for (const state of ['disabled', 'deleted', 'revoked']) test(`callable re-verification rejects ${state} user with cached genuine token`, async () => {
    const uid = `callable-${state}`, session = await client(uid);
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
test('unknown input names and values never leak in callable errors', async () => {
    await assert.rejects(call(data({ ...minimal(), 'private-customer-address': 'private-value' })), error => {
        assert.equal(error.code, 'functions/invalid-argument'); const encoded = JSON.stringify(error.details);
        assert.equal(encoded.includes('private'), false); assert.equal(error.details.path, undefined); return true;
    });
});
const mapping = { UNAUTHENTICATED: 'unauthenticated', INVALID_REQUEST: 'invalid-argument', INVALID_INVOICE_DRAFT: 'invalid-argument',
    REFERENCE_NOT_SUPPORTED: 'failed-precondition', BUSINESS_ACCESS_DENIED: 'permission-denied', BUSINESS_NOT_FOUND: 'not-found',
    BUSINESS_INACTIVE: 'failed-precondition', INVALID_BUSINESS_ROLE: 'permission-denied', INVOICE_ALREADY_EXISTS: 'already-exists', UNAVAILABLE: 'unavailable', INTERNAL: 'internal' };
for (const [code, transport] of Object.entries(mapping)) test(`stable HttpsError mapping ${code}`, () => {
    const error = callableError(new SaveInvoiceDraftError(code)); assert.equal(error.code, transport); assert.deepEqual(error.details, { code });
});
test('raw SDK failure maps to safe internal details', () => { const error = callableError(new Error('private-service-account-token')); assert.equal(error.code, 'internal'); assert.deepEqual(error.details, { code: 'INTERNAL' }); assert.equal(error.message.includes('private'), false); });
const safeEnv = () => ({ BUSINESSBOSS_LOCAL_FUNCTIONS: 'true', GCLOUD_PROJECT: demoProjectId, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FUNCTIONS_EMULATOR_HOST: '127.0.0.1:5001' });
for (const [key, value] of [['GCLOUD_PROJECT', 'production'], ['FIRESTORE_EMULATOR_HOST', 'remote:8080'], ['FIREBASE_AUTH_EMULATOR_HOST', 'remote:9099'],
    ['FUNCTIONS_EMULATOR_HOST', 'remote:5001'], ['GOOGLE_APPLICATION_CREDENTIALS', 'private.json'], ['FIREBASE_TOKEN', 'private-token']]) test(`callable safety rejects ${key}`, () => {
    assert.throws(() => assertFunctionsEmulatorEnvironment({ ...safeEnv(), [key]: value }));
    assert.throws(() => assertLocalFunctionsEnvironment({ ...safeEnv(), [key]: value }));
});
test('missing emulator settings fail closed and production cannot use local App Check bypass', () => {
    for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FUNCTIONS_EMULATOR_HOST']) { const env = safeEnv(); delete env[key]; assert.throws(() => assertLocalFunctionsEnvironment(env)); }
    assert.equal(callableOptions({}).enforceAppCheck, true); assert.equal(callableOptions(safeEnv()).enforceAppCheck, false);
    assert.throws(() => callableOptions({ ...safeEnv(), GCLOUD_PROJECT: 'production' }));
    assert.throws(() => assertLocalFunctionsEnvironment(safeEnv(), { invocation: true }));
});
test('Functions package and canonical server source are excluded from Hosting', async () => {
    const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
    assert.ok(config.hosting.ignore.includes('functions/**')); assert.ok(config.hosting.ignore.includes('server/**'));
    assert.equal(config.functions.source, 'functions'); assert.equal(config.functions.runtime, 'nodejs24');
});
test('packaged source matches canonical source byte-for-byte and contains no test/browser imports', async () => {
    for (const file of ['js/backend/invoiceDraftCommand.js', 'js/finance/invoiceCalculations.js', 'js/finance/invoiceDraftValidator.js',
        'server/invoiceDraftBoundary.js', 'server/invoiceDraftRepository.js', 'server/emulatorSafety.js']) {
        const canonical = await readFile(new URL(`../${file}`, import.meta.url));
        const packaged = await readFile(new URL(`../functions/node_modules/businessboss/${file}`, import.meta.url));
        assert.deepEqual(packaged, canonical, `Stale package: ${file}; rebuild and install the local package.`);
        assert.doesNotMatch(packaged.toString(), /from ['"][^'"]*(?:tests\/|firebase\/config)/);
    }
    for (const file of ['index.js', 'saveInvoiceDraft.js', 'admin.js', 'localEnvironment.js']) {
        const source = await readFile(new URL(`../functions/src/${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /from ['"][^'"]*(?:tests\/|firebase\/config)/);
    }
});
test('pinned callable SDK publicly exposes rawToken and endpoint is 2nd-gen onCall', async () => {
    const types = await readFile(new URL('../functions/node_modules/firebase-functions/lib/common/providers/https.d.ts', import.meta.url), 'utf8');
    assert.match(types, /rawToken: string/);
    const source = await readFile(new URL('../functions/src/index.js', import.meta.url), 'utf8');
    assert.match(source, /firebase-functions\/v2\/https/); assert.match(source, /saveInvoiceDraft = onCall/);
});
