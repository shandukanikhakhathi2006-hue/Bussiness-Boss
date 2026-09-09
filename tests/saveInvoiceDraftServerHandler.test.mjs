import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Timestamp } from 'firebase-admin/firestore';
import { createEmulatorSaveInvoiceDraftHandler, SaveInvoiceDraftError } from './server/emulatorSaveInvoiceDraftHandler.mjs';
import { createEmulatorAdmin } from './server/emulatorAdmin.mjs';
import { createDraftInTransaction } from './server/invoiceDraftRepository.mjs';
import { safeError } from './server/invoiceDraftBoundary.mjs';
import { assertServerEmulatorEnvironment, demoProjectId, waitForFirestore } from './emulatorEnvironment.mjs';
import { validateInvoiceDraft } from '../js/finance/invoiceDraftValidator.js';
import { authorizeAndPrepareInvoiceDraftUpdate } from '../js/backend/invoiceDraftUpdateCommand.js';

let admin, handler, token, otherToken;
const minimal = () => ({ currency: 'ZAR', lineItems: [] });
const full = () => ({ customerId: null, customerName: ' Customer 王 ', customerEmail: ' customer@example.test ',
    customerAddress: ' Street\r\nCity ', currency: 'ZAR', issueDate: '2026-09-09', dueDate: '2026-09-30',
    lineItems: [{ id: 'line-1', description: ' Consulting ', quantity: '1.500', unitPriceMinor: 1000,
        discountMinor: 100, taxRateBps: 1000, taxCode: 'STANDARD', catalogItemId: null }] });
const envelope = (draft = minimal()) => ({ businessId: 'business-a', invoiceId: 'draft-1', draft });
const save = (data = envelope(), idToken = token) => handler.saveInvoiceDraft({ idToken, data });
const business = () => admin.db.doc('businesses/business-a');
const member = () => business().collection('members').doc('user-a');
const invoice = () => business().collection('invoices').doc('draft-1');
const expect = async (promise, code) => assert.rejects(promise, error => {
    assert.ok(error instanceof SaveInvoiceDraftError); assert.equal(error.code, code);
    assert.equal(error.stack, undefined); assert.equal(error.cause, undefined); return true;
});
async function authRequest(route, body) {
    const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/${route}?key=emulator-only`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
    });
    assert.equal(response.ok, true, `Auth emulator HTTP ${response.status}`);
    return response.json();
}
async function user(uid) {
    await admin.auth.createUser({ uid, email: `${uid}@example.test`, password: 'local-test-password' });
    const result = await authRequest('accounts:signInWithPassword', { email: `${uid}@example.test`, password: 'local-test-password', returnSecureToken: true });
    assert.equal(result.localId, uid);
    return result.idToken;
}
before(async () => {
    assertServerEmulatorEnvironment(process.env); await waitForFirestore();
    admin = createEmulatorAdmin(); handler = await createEmulatorSaveInvoiceDraftHandler();
    token = await user('user-a'); otherToken = await user('user-b');
});
beforeEach(async () => {
    const response = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${demoProjectId}/databases/(default)/documents`, { method: 'DELETE' });
    assert.equal(response.ok, true); await response.body?.cancel();
    await business().set({ ownerId: 'user-a', active: true });
    await member().set({ uid: 'user-a', role: 'owner', active: true });
});
after(async () => { await handler?.close(); await admin?.close(); });

test('real emulator-issued token creates an exact minimal zero-total draft and safe response', async () => {
    assert.deepEqual(await save(), { invoiceId: 'draft-1', lifecycleStatus: 'draft' });
    const stored = (await invoice().get()).data();
    assert.ok(stored.createdAt instanceof Timestamp); assert.ok(stored.updatedAt instanceof Timestamp);
    assert.ok(stored.createdAt.isEqual(stored.updatedAt));
    const { createdAt, updatedAt, ...data } = stored;
    assert.deepEqual(data, { schemaVersion: 2, businessId: 'business-a', ownerId: 'user-a', lifecycleStatus: 'draft', paymentStatus: 'not_due', revision: 1,
        customer: { id: null, name: '', email: null, address: null }, currency: 'ZAR', issueDate: null, dueDate: null, lineItems: [],
        subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0, amountPaidMinor: 0, balanceDueMinor: 0,
        createdBy: 'user-a', updatedBy: 'user-a' });
});
test('full snapshot matches Stage 8B normalization and Stage 8A calculated amounts', async () => {
    const raw = full(), original = structuredClone(raw), normalized = validateInvoiceDraft(raw);
    await save(envelope(raw)); assert.deepEqual(raw, original);
    const data = (await invoice().get()).data();
    assert.equal(data.revision, 1); assert.ok(Number.isSafeInteger(data.revision) && data.revision > 0);
    assert.deepEqual(data.lineItems, normalized.lineItems); assert.equal(data.totalMinor, 1540);
    for (const [key, value] of Object.entries(normalized.totals)) assert.equal(data[key], value);
    assert.deepEqual(data.customer, { id: null, name: 'Customer 王', email: 'customer@example.test', address: 'Street\nCity' });
    assert.equal(data.balanceDueMinor, data.totalMinor);
});
test('caller mutation immediately after invocation cannot change persisted routing or nested input', async () => {
    const data = envelope(full()); const pending = save(data);
    data.businessId = 'other'; data.invoiceId = 'other'; data.draft.customerName = 'changed'; data.draft.lineItems[0].unitPriceMinor = 999;
    await pending; const stored = (await invoice().get()).data(); assert.equal(stored.customer.name, 'Customer 王'); assert.equal(stored.totalMinor, 1540);
});
for (const idToken of [undefined, null, '', 'invalid-token', 123]) test(`unauthenticated token ${String(idToken)}`, async () => {
    await expect(handler.saveInvoiceDraft({ idToken, data: envelope() }), 'UNAUTHENTICATED');
});
test('omitted token is unauthenticated', () => expect(handler.saveInvoiceDraft({ data: envelope() }), 'UNAUTHENTICATED'));
test('wrong authenticated user cannot borrow owner business', () => expect(save(envelope(), otherToken), 'BUSINESS_ACCESS_DENIED'));
for (const state of ['disabled', 'deleted', 'revoked']) test(`${state} Auth emulator user rejected`, async () => {
    const uid = `user-${state}`, issuedToken = await user(uid);
    if (state === 'disabled') await admin.auth.updateUser(uid, { disabled: true });
    if (state === 'deleted') await admin.auth.deleteUser(uid);
    let testedToken = issuedToken;
    if (state === 'revoked') {
        await admin.auth.revokeRefreshTokens(uid);
        // Emulator tokens are unsigned: set auth_time earlier than revocation to
        // avoid same-second clock races. Success paths always use untouched tokens.
        const parts = issuedToken.split('.'); const payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
        payload.auth_time -= 60; parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url'); testedToken = parts.join('.');
    }
    await expect(save(envelope(), testedToken), 'UNAUTHENTICATED');
});
for (const claim of ['exp', 'aud', 'iss']) test(`invalid token ${claim} rejected`, async () => {
    const parts = token.split('.'), payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
    payload[claim] = claim === 'exp' ? 1 : 'wrong-project'; parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
    await expect(save(envelope(), parts.join('.')), 'UNAUTHENTICATED');
});
for (const key of ['uid', 'ownerId', 'role', 'active', 'actorUid', 'authContext', 'businessContext', 'preparedCommand', 'schemaVersion',
    'lifecycleStatus', 'paymentStatus', 'amountPaidMinor', 'balanceDueMinor', 'totals', 'createdAt', 'updatedAt', 'invoiceNumber', 'provider', 'paymentReference']) {
    test(`envelope authority injection ${key} rejected`, () => expect(save({ ...envelope(), [key]: 'secret-injection' }), 'INVALID_REQUEST'));
}
test('outer uid cannot override verified uid', () => expect(handler.saveInvoiceDraft({ idToken: otherToken, data: envelope(), uid: 'user-a' }), 'INVALID_REQUEST'));
for (const key of ['businessId', 'invoiceId', 'draft']) test(`missing envelope ${key}`, async () => {
    const data = envelope(); delete data[key]; await expect(save(data), 'INVALID_REQUEST');
});
for (const value of [null, [], 'data', 1]) test(`invalid envelope ${JSON.stringify(value)}`, () => expect(save(value), 'INVALID_REQUEST'));
const badBusiness = [null, '', ' a', 'a ', 'a/b', '.', '..', '__reserved__', 'a\n', 'a\u0085', '\ud800', 'a'.repeat(129)];
for (const [i, value] of badBusiness.entries()) test(`invalid business route ${i}`, () => expect(save({ ...envelope(), businessId: value }), 'INVALID_REQUEST'));
for (const [i, value] of [null, '', 'a/b', '.', '..', '__x__', ' a', 'a ', 'ａ', 'a'.repeat(129)].entries())
    test(`invalid invoice route ${i}`, () => expect(save({ ...envelope(), invoiceId: value }), 'INVALID_REQUEST'));
test('opaque Unicode business ID is preserved without normalization', async () => {
    const businessId = '業'.repeat(128); await admin.db.collection('businesses').doc(businessId).set({ ownerId: 'user-a', active: true });
    await admin.db.collection('businesses').doc(businessId).collection('members').doc('user-a').set({ uid: 'user-a', role: 'owner', active: true });
    await save({ ...envelope(), businessId, invoiceId: 'a'.repeat(128) });
    assert.equal((await admin.db.collection('businesses').doc(businessId).collection('invoices').doc('a'.repeat(128)).get()).data().businessId, businessId);
});
test('invoice route rejects trailing line terminators despite regex end-anchor behavior', async () => {
    for (const suffix of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
        await expect(save({ ...envelope(), invoiceId: `draft-1${suffix}` }), 'INVALID_REQUEST');
    }
    assert.equal((await business().collection('invoices').get()).empty, true);
});
for (const key of ['totals', 'subtotalMinor', 'totalMinor', 'taxMinor', 'discountMinor', 'amountPaidMinor', 'balanceDueMinor', 'lifecycleStatus',
    'paymentStatus', 'createdAt', 'updatedAt', 'provider', 'paymentReference', 'invoiceNumber', 'ownerId', 'uid', 'role'])
    test(`raw draft authority ${key} rejected by Stage 8B`, () => expect(save(envelope({ ...minimal(), [key]: 'private-value' })), 'INVALID_INVOICE_DRAFT'));
test('invalid currency maps domain error and safe field path', async () => {
    await assert.rejects(save(envelope({ currency: 'secret', lineItems: [] })), error => error.code === 'INVALID_INVOICE_DRAFT'
        && error.domainCode === 'INVALID_CURRENCY' && error.path === 'currency' && !JSON.stringify(error).includes('secret'));
});
test('arithmetic error maps safely', async () => {
    const draft = full(); draft.lineItems[0].unitPriceMinor = -1; await expect(save(envelope(draft)), 'INVALID_INVOICE_DRAFT');
});
test('101 lines rejected by existing Stage 8B maximum', async () => {
    const draft = full(); draft.lineItems = Array.from({ length: 101 }, (_, i) => ({ ...draft.lineItems[0], id: `l-${i}` }));
    await expect(save(envelope(draft)), 'INVALID_INVOICE_DRAFT');
});
for (const field of ['customerId', 'catalogItemId']) test(`non-null ${field} rejected`, async () => {
    const draft = full(); if (field === 'customerId') draft.customerId = ' customer-a '; else draft.lineItems[0].catalogItemId = ' item-a ';
    await expect(save(envelope(draft)), 'REFERENCE_NOT_SUPPORTED'); assert.equal((await invoice().get()).exists, false);
});
test('blank optional references retain Stage 8B rejection semantics', async () => {
    const draft = full(); draft.customerId = ' '; await expect(save(envelope(draft)), 'INVALID_INVOICE_DRAFT');
    draft.customerId = null; draft.lineItems[0].catalogItemId = ' '; await expect(save(envelope(draft)), 'INVALID_INVOICE_DRAFT');
});
test('absent business hidden from non-member', async () => {
    await business().delete(); await member().delete(); await expect(save(), 'BUSINESS_ACCESS_DENIED');
});
test('active member receives missing business error', async () => { await business().delete(); await expect(save(), 'BUSINESS_NOT_FOUND'); });
for (const [label, change, code] of [
    ['inactive', { active: false }, 'BUSINESS_INACTIVE'], ['archived', { archived: true }, 'BUSINESS_INACTIVE'],
    ['malformed owner', { ownerId: 1 }, 'INTERNAL'], ['blank owner', { ownerId: '' }, 'INTERNAL'],
    ['malformed active', { active: 'true' }, 'INTERNAL'], ['malformed archived', { archived: 'false' }, 'INTERNAL'],
    ['malformed timezone', { timezone: 'invalid-zone' }, 'INTERNAL'], ['changed owner', { ownerId: 'user-b' }, 'BUSINESS_ACCESS_DENIED']]) {
    test(`business ${label} fails closed`, async () => { await business().update(change); await expect(save(), code); assert.equal((await invoice().get()).exists, false); });
}
test('trusted optional archived and timezone accepted without adding stored fields', async () => {
    await business().update({ archived: false, timezone: 'Africa/Johannesburg' }); await save(); assert.equal((await invoice().get()).data().timezone, undefined);
});
test('owner without membership denied', async () => { await member().delete(); await expect(save(), 'BUSINESS_ACCESS_DENIED'); });
for (const [label, change] of [['inactive', { active: false }], ['wrong uid', { uid: 'user-b' }], ['malformed active', { active: 1 }], ['malformed role', { role: 1 }]])
    test(`membership ${label} denied`, async () => { await member().update(change); await expect(save(), 'BUSINESS_ACCESS_DENIED'); });
for (const role of ['staff', 'accountant', 'viewer', 'Owner', 'OWNER']) test(`${role} cannot write`, async () => {
    await member().update({ role }); await expect(save(), 'INVALID_BUSINESS_ROLE');
});
test('membership in another business grants no access', () => expect(save({ ...envelope(), businessId: 'business-b' }), 'BUSINESS_ACCESS_DENIED'));
test('authorization precedes conflict disclosure', async () => { await save(); await expect(save(envelope(), otherToken), 'BUSINESS_ACCESS_DENIED'); });
for (const different of [false, true]) test(`duplicate ${different ? 'different' : 'same'} payload cannot overwrite timestamps or data`, async () => {
    await save(); const original = (await invoice().get()).data();
    await expect(save(envelope(different ? full() : minimal())), 'INVOICE_ALREADY_EXISTS'); assert.deepEqual((await invoice().get()).data(), original);
});
test('concurrent create has exactly one winner and one safe conflict', async () => {
    const results = await Promise.allSettled([save(), save()]); assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'INVOICE_ALREADY_EXISTS');
    assert.equal((await business().collection('invoices').get()).size, 1);
    assert.equal((await invoice().get()).data().revision, 1);
});

for (const field of ['revision', 'expectedRevision']) for (const location of ['envelope', 'draft']) {
    test(`create rejects numeric ${field} in ${location} without influencing revision`, async () => {
        const data = envelope(); (location === 'envelope' ? data : data.draft)[field] = 999;
        await expect(save(data), location === 'envelope' ? 'INVALID_REQUEST' : 'INVALID_INVOICE_DRAFT');
        assert.equal((await invoice().get()).exists, false);
        await save(); assert.equal((await invoice().get()).data().revision, 1);
    });
}
for (const revision of [undefined, 7]) test(`duplicate preserves pre-existing revision ${revision} without repair`, async () => {
    await save(); const existing = (await invoice().get()).data();
    if (revision === undefined) delete existing.revision; else existing.revision = revision;
    await invoice().set(existing); // Emulator fixture for an old or later-version document.
    await expect(save(), 'INVOICE_ALREADY_EXISTS');
    assert.deepEqual((await invoice().get()).data(), existing);
});
for (const [label, draft] of [['minimal', minimal], ['full', full]]) test(`created ${label} snapshot satisfies unchanged Stage 9I without persisting update`, async () => {
    const input = draft(); await save(envelope(input));
    const persisted = (await invoice().get()).data();
    const plain = { ...persisted };
    for (const field of ['createdAt', 'updatedAt']) plain[field] = { seconds: persisted[field].seconds, nanoseconds: persisted[field].nanoseconds };
    const args = { authContext: { uid: 'user-a' }, businessContext: { businessId: 'business-a', ownerId: 'user-a', role: 'owner' },
        businessId: 'business-a', invoiceId: 'draft-1', storedInvoice: plain, expectedRevision: 1, input };
    const prepared = authorizeAndPrepareInvoiceDraftUpdate(args);
    assert.equal(prepared.previousRevision, 1); assert.equal(prepared.nextRevision, 2);
    assert.deepEqual(prepared.preserved, { createdBy: persisted.createdBy, createdAt: plain.createdAt });
    assert.deepEqual((await invoice().get()).data(), persisted);
    delete plain.revision;
    assert.throws(() => authorizeAndPrepareInvoiceDraftUpdate(args), error => error.code === 'INTERNAL');
});
test('only one invoice written; legacy, business/member, accounting collections untouched', async () => {
    const businessBefore = (await business().get()).data(), memberBefore = (await member().get()).data();
    await admin.db.doc('invoices/legacy').set({ sentinel: true }); await admin.db.doc('payments/legacy').set({ sentinel: true });
    await save(envelope(full())); assert.deepEqual((await business().get()).data(), businessBefore); assert.deepEqual((await member().get()).data(), memberBefore);
    for (const name of ['invoices', 'payments']) { const docs = await admin.db.collection(name).get(); assert.equal(docs.size, 1); assert.deepEqual(docs.docs[0].data(), { sentinel: true }); }
    for (const name of ['financialEvents', 'counters', 'outbox', 'payments']) {
        assert.equal((await business().collection(name).get()).empty, true);
        if (name !== 'payments') assert.equal((await admin.db.collection(name).get()).empty, true);
    }
    assert.deepEqual((await business().listCollections()).map(ref => ref.id).sort(), ['invoices', 'members']);
});
for (const kind of ['membership', 'business', 'owner']) test(`transaction retry re-reads revoked ${kind} authority`, async () => {
    let attempts = 0;
    // Force SDK ABORTED after a complete first callback, before commit. The SDK
    // rolls back its reads/write and retries; mutate authority before retry reads.
    await assert.rejects(admin.db.runTransaction(async transaction => {
        attempts += 1;
        if (attempts === 2) {
            if (kind === 'membership') await member().update({ active: false });
            if (kind === 'business') await business().update({ active: false });
            if (kind === 'owner') await business().update({ ownerId: 'user-b' });
        }
        await createDraftInTransaction(transaction, admin.db, 'user-a', envelope());
        if (attempts === 1) throw Object.assign(new Error('test-only deterministic abort'), { code: 10 });
    }), error => error.code === (kind === 'business' ? 'BUSINESS_INACTIVE' : 'BUSINESS_ACCESS_DENIED'));
    assert.equal(attempts, 2); assert.equal((await invoice().get()).exists, false);
});
test('accessors, proxies and toJSON are never executed', async () => {
    let calls = 0; const draft = minimal(); Object.defineProperty(draft, 'customerName', { get() { calls++; return 'x'; }, enumerable: true });
    await expect(save(envelope(draft)), 'INVALID_REQUEST');
    await expect(save(new Proxy({}, { ownKeys() { calls++; return []; } })), 'INVALID_REQUEST');
    await expect(save(envelope({ ...minimal(), toJSON() { calls++; } })), 'INVALID_REQUEST'); assert.equal(calls, 0);
});
test('cycles, sparse arrays and oversized requests rejected safely', async () => {
    const cycle = minimal(); cycle.extra = cycle; await expect(save(envelope(cycle)), 'INVALID_REQUEST');
    await expect(save(envelope({ currency: 'ZAR', lineItems: Array(2) })), 'INVALID_REQUEST');
    await expect(save(envelope({ ...minimal(), customerName: 'x'.repeat(512 * 1024) })), 'INVALID_REQUEST');
});
test('unknown field names and values never leak via domain error paths', async () => {
    await assert.rejects(save(envelope({ ...minimal(), 'private-customer-address': 'secret-value' })), error => {
        const text = JSON.stringify(error); assert.equal(text.includes('private-customer'), false); assert.equal(text.includes('secret-value'), false);
        assert.equal(text.includes(token), false); assert.equal(error.path, undefined); return true;
    });
});
for (const [code, expected] of [[14, 'UNAVAILABLE'], [6, 'INVOICE_ALREADY_EXISTS'], ['app/network-error', 'UNAVAILABLE'], ['unexpected', 'INTERNAL']])
    test(`raw SDK error ${code} mapped without details`, () => {
        const error = safeError(Object.assign(new Error(`secret-token-${token}`), { code, details: 'customer-address' }));
        assert.equal(error.code, expected); assert.equal(error.stack, undefined); assert.equal(JSON.stringify(error).includes('secret'), false); assert.equal(error.details, undefined);
    });
const safeEnv = () => ({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', GCLOUD_PROJECT: demoProjectId });
for (const [key, value] of [['FIRESTORE_EMULATOR_HOST', 'remote:8080'], ['FIREBASE_AUTH_EMULATOR_HOST', 'remote:9099'], ['GCLOUD_PROJECT', 'production'],
    ['GOOGLE_CLOUD_PROJECT', 'production'], ['FIREBASE_CONFIG', '{"projectId":"production"}'], ['GOOGLE_APPLICATION_CREDENTIALS', 'secret.json'],
    ['GOOGLE_CLOUD_KEYFILE_JSON', '{}'], ['GCLOUD_KEYFILE_JSON', '{}'], ['FIREBASE_TOKEN', 'secret'], ['FIREBASE_SERVICE_ACCOUNT', '{}']])
    test(`unsafe environment ${key} rejected before initialization`, () => assert.throws(() => assertServerEmulatorEnvironment({ ...safeEnv(), [key]: value })));
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) test(`missing ${key} fails closed`, async () => {
    const env = safeEnv(); delete env[key]; assert.throws(() => assertServerEmulatorEnvironment(env));
    const original = process.env[key]; delete process.env[key];
    try { await assert.rejects(createEmulatorSaveInvoiceDraftHandler()); await expect(save(), 'INTERNAL'); }
    finally { process.env[key] = original; }
});
test('local boundary is Hosting-excluded and never imports browser config or ADC', async () => {
    const config = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
    assert.ok(config.hosting.ignore.includes('tests/**')); assert.ok(config.hosting.ignore.includes('functions/**')); assert.ok(config.hosting.ignore.includes('server/**'));
    for (const name of ['emulatorAdmin.mjs', 'emulatorSaveInvoiceDraftHandler.mjs', 'invoiceDraftRepository.mjs', 'invoiceDraftBoundary.mjs']) {
        const source = await readFile(new URL(`./server/${name}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /firebase\/config|applicationDefault\(|withSecurityRulesDisabled|invoiceIssueValidator/);
    }
});
test('closed handler cannot write', async () => {
    const local = await createEmulatorSaveInvoiceDraftHandler(); await local.close(); await local.close();
    await expect(local.saveInvoiceDraft({ idToken: token, data: envelope() }), 'UNAVAILABLE');
});
