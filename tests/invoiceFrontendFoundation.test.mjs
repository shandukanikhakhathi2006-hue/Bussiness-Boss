import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolveClientEnvironment, initializeFirebaseClient, DEMO_PROJECT_ID, LOCAL_MODE_KEY } from '../js/firebase/clientEnvironment.js';
import { getLocalBusinessContext, DEMO_BUSINESS_ID } from '../js/firebase/localBusinessContext.js';
import { createInvoiceDraftApi } from '../js/features/invoiceDraftApi.js';
import { createInvoiceDraftState } from '../js/features/invoiceDraftState.js';

const environment = { local: true, projectId: DEMO_PROJECT_ID };
const location = (search = '', hostname = '127.0.0.1', pathname = '/invoices.html') => ({ search, hostname, pathname, protocol: 'http:' });
const storage = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
function sdkDouble(existing = []) {
    const calls = [], apps = [...existing];
    const sdk = {
        getApps: () => apps,
        initializeApp: options => { calls.push(['initializeApp', options]); const app = { options }; apps.push(app); return app; }
    };
    for (const name of ['getAuth', 'getFirestore', 'getFunctions']) sdk[name] = (...args) => {
        const result = { name }; calls.push([name, ...args]); return result;
    };
    for (const name of ['connectAuthEmulator', 'connectFirestoreEmulator', 'connectFunctionsEmulator']) sdk[name] = (...args) => calls.push([name, ...args]);
    return { sdk, calls };
}
test('localhost alone does not enable emulator mode', () => assert.equal(resolveClientEnvironment(location(), storage()).local, false));
test('explicit switch persists through same-tab Auth redirects and can be disabled', () => {
    const session = storage();
    assert.deepEqual(resolveClientEnvironment(location('?emulator=1'), session), environment);
    assert.equal(session.getItem(LOCAL_MODE_KEY), '1');
    assert.equal(resolveClientEnvironment(location('', '127.0.0.1', '/login.html'), session).local, true);
    assert.equal(resolveClientEnvironment(location('?emulator=0'), session).local, false);
});
test('remote production ignores stored local mode', () => {
    const session = { getItem: () => { throw Error('must not read'); } };
    assert.equal(resolveClientEnvironment(location('', 'business.example'), session).local, false);
});
for (const host of ['business.example', '127.0.0.1.example', '192.168.1.2']) test(`explicit local mode blocked on ${host}`, () => {
    assert.throws(() => resolveClientEnvironment(location('?emulator=1', host), storage()));
});
for (const query of ['?emulator=true', '?emulator=1&emulator=0', '?emulator=']) test(`malformed switch fails closed: ${query}`, () => {
    assert.throws(() => resolveClientEnvironment(location(query), storage()));
});
test('v2 page without local mode fails before SDK initialization', () => {
    assert.throws(() => resolveClientEnvironment(location('', '127.0.0.1', '/invoices-v2.html'), storage()));
    assert.throws(() => resolveClientEnvironment(location('', 'business.example', '/invoices-v2.html'), storage()));
});
test('unavailable session storage fails closed', () => {
    assert.throws(() => resolveClientEnvironment(location('?emulator=1'), { setItem: () => { throw Error('blocked'); } }));
});
test('local single app, correct region and all three emulator connections; no production config', () => {
    const { sdk, calls } = sdkDouble();
    const result = initializeFirebaseClient(sdk, { projectId: 'forbidden-production', apiKey: 'forbidden-key' }, environment);
    assert.equal(calls.filter(call => call[0] === 'initializeApp').length, 1);
    assert.equal(result.firebaseApp.options.projectId, DEMO_PROJECT_ID);
    assert.doesNotMatch(JSON.stringify(calls), /forbidden/);
    for (const name of ['getAuth', 'getFirestore', 'getFunctions']) assert.equal(calls.find(call => call[0] === name)[1], result.firebaseApp);
    assert.equal(calls.find(call => call[0] === 'getFunctions')[2], 'africa-south1');
    assert.deepEqual(calls.filter(call => call[0].startsWith('connect')), [
        ['connectAuthEmulator', result.auth, 'http://127.0.0.1:9099'],
        ['connectFirestoreEmulator', result.firestore, '127.0.0.1', 8080],
        ['connectFunctionsEmulator', result.functions, '127.0.0.1', 5001]
    ]);
});
test('default configuration preserved without emulator calls', () => {
    const { sdk, calls } = sdkDouble(); const config = { projectId: 'production-example' };
    const result = initializeFirebaseClient(sdk, config, { local: false });
    assert.equal(result.firebaseApp.options, config);
    assert.equal(calls.filter(call => call[0].startsWith('connect')).length, 0);
});
test('existing app reused; no second initialization', () => {
    const app = { options: { projectId: DEMO_PROJECT_ID } }; const { sdk, calls } = sdkDouble([app]);
    assert.equal(initializeFirebaseClient(sdk, {}, environment).firebaseApp, app);
    assert.equal(calls.some(call => call[0] === 'initializeApp'), false);
});
test('wrong existing project or multiple apps rejected before services are initialized', () => {
    for (const apps of [[{ options: { projectId: 'wrong' } }], [{}, {}]]) {
        const { sdk, calls } = sdkDouble(apps);
        assert.throws(() => initializeFirebaseClient(sdk, {}, environment));
        assert.deepEqual(calls, []);
    }
});
test('demo routing requires signed-in local session and never derives business from uid', () => {
    for (const uid of ['owner-a', 'outsider-b']) assert.deepEqual(getLocalBusinessContext(environment, { uid }), { businessId: DEMO_BUSINESS_ID });
    assert.throws(() => getLocalBusinessContext(environment, null));
    assert.throws(() => getLocalBusinessContext({ local: false }, { uid: 'owner-a' }));
    assert.throws(() => getLocalBusinessContext({ local: true, projectId: 'wrong' }, { uid: 'owner-a' }));
});
const draft = () => ({ customerId: null, customerName: 'Customer', customerEmail: null, customerAddress: null,
    currency: 'ZAR', issueDate: null, dueDate: null, lineItems: ['line-b', 'line-a'].map(id => ({
        id, description: 'Consulting', quantity: '1.500', unitPriceMinor: 1000, discountMinor: 0, taxRateBps: 0, taxCode: 'ZERO', catalogItemId: null
    })) });
const totals = { subtotalMinor: 3000, discountMinor: 0, taxMinor: 0, totalMinor: 3000 };
const response = revision => ({ invoiceId: 'draft-1', lifecycleStatus: 'draft', revision, draft: draft(), totals });
function apiDouble(env = environment, user = { uid: 'demo-user' }) {
    const calls = [], functions = {};
    const api = createInvoiceDraftApi({ environment: env, functions, getCurrentUser: () => user,
        httpsCallable: (instance, name) => async data => { calls.push({ instance, name, data }); return { data: response(7) }; } });
    return { api, calls, functions };
}
const authority = { uid: 'evil', ownerId: 'evil', role: 'owner', idToken: 'secret', token: 'secret', authContext: {}, businessContext: {}, totals, createdAt: 0, provider: {} };
for (const method of ['saveInvoiceDraft', 'getInvoiceDraft', 'updateInvoiceDraft']) test(`${method} uses exact envelope and existing Functions instance`, async () => {
    const { api, calls, functions } = apiDouble();
    const input = { ...draft(), ...authority, revision: 100, invoiceNumber: 'forbidden' };
    input.lineItems = input.lineItems.map(line => ({ ...line, ...authority, totalMinor: 99 }));
    const result = await api[method]({ businessId: DEMO_BUSINESS_ID, invoiceId: 'draft-1', expectedRevision: 7, draft: input, input, ...authority });
    const expected = { businessId: DEMO_BUSINESS_ID, invoiceId: 'draft-1' };
    if (method === 'saveInvoiceDraft') expected.draft = draft();
    if (method === 'updateInvoiceDraft') Object.assign(expected, { expectedRevision: 7, input: draft() });
    assert.deepEqual(calls, [{ instance: functions, name: method, data: expected }]);
    assert.deepEqual(result, response(7));
});
test('adapter fails closed outside local demo and signed-in session', async () => {
    for (const [env, user] of [[{ local: false }, { uid: 'user' }], [{ local: true, projectId: 'wrong' }, { uid: 'user' }], [environment, null]]) {
        const { api, calls } = apiDouble(env, user);
        await assert.rejects(api.getInvoiceDraft({ businessId: DEMO_BUSINESS_ID, invoiceId: 'draft-1' }));
        assert.deepEqual(calls, []);
    }
});
test('adapter passes callable failure through without retries', async () => {
    let count = 0; const failure = { code: 'functions/unavailable' };
    const api = createInvoiceDraftApi({ environment, functions: {}, getCurrentUser: () => ({ uid: 'user' }),
        httpsCallable: () => async () => { count++; throw failure; } });
    await assert.rejects(api.getInvoiceDraft({ businessId: DEMO_BUSINESS_ID, invoiceId: 'draft-1' }), error => error === failure);
    assert.equal(count, 1);
});
test('initial editor model never invents existing or new revision', () => {
    for (const invoiceId of [null, 'draft-1']) {
        const state = createInvoiceDraftState({ businessId: DEMO_BUSINESS_ID, invoiceId }).snapshot();
        assert.equal(state.revision, null); assert.equal(state.status, 'idle'); assert.equal(state.draft, null);
    }
});
test('server load preserves order, exact quantities and null references, separates totals, copies state', () => {
    const store = createInvoiceDraftState({ businessId: DEMO_BUSINESS_ID }); const input = response(7);
    store.adoptLoaded(input);
    assert.equal(store.snapshot().revision, 7);
    assert.deepEqual(store.snapshot().draft, draft());
    assert.deepEqual(store.snapshot().totals, totals);
    assert.equal(store.snapshot().draft.totals, undefined);
    input.draft.lineItems.reverse(); const external = store.snapshot(); external.draft.customerName = 'mutated';
    assert.deepEqual(store.snapshot().draft, draft());
});
for (const revision of [undefined, null, 0, -1, 1.2, '1', Number.MAX_SAFE_INTEGER + 1]) test(`reject invalid server revision ${String(revision)} atomically`, () => {
    const store = createInvoiceDraftState({ businessId: DEMO_BUSINESS_ID, invoiceId: 'draft-1' }); const before = store.snapshot();
    assert.throws(() => store.adoptLoaded(response(revision))); assert.deepEqual(store.snapshot(), before);
});
test('loaded response must match invoice and draft lifecycle', () => {
    const store = createInvoiceDraftState({ businessId: DEMO_BUSINESS_ID, invoiceId: 'draft-1' });
    assert.throws(() => store.adoptLoaded({ ...response(7), invoiceId: 'other' }));
    assert.throws(() => store.adoptLoaded({ ...response(7), lifecycleStatus: 'issued' }));
});
test('update adopts returned revision without locally incrementing and clears old totals', () => {
    const store = createInvoiceDraftState({ businessId: DEMO_BUSINESS_ID });
    assert.throws(() => store.adoptUpdated({ invoiceId: 'draft-1', revision: 1 }));
    store.adoptLoaded(response(7)); store.adoptUpdated({ invoiceId: 'draft-1', revision: 9 });
    assert.equal(store.snapshot().revision, 9); assert.equal(store.snapshot().totals, null);
    assert.throws(() => store.adoptUpdated({ invoiceId: 'draft-1', revision: 8 }));
    assert.throws(() => store.adoptUpdated({ invoiceId: 'other', revision: 10 }));
});
test('status transitions preserve data and revision without implementing a workflow', () => {
    const store = createInvoiceDraftState({ businessId: DEMO_BUSINESS_ID }); store.adoptLoaded(response(3));
    for (const status of ['loading', 'ready', 'saving', 'conflict', 'error', 'idle']) {
        store.setStatus(status); assert.equal(store.snapshot().status, status);
        assert.equal(store.snapshot().revision, 3); assert.deepEqual(store.snapshot().draft, draft());
    }
    assert.throws(() => store.setStatus('invented'));
});
test('production and isolated rules remain pinned', () => {
    for (const [file, expected] of [['firestore.rules', '500A674EBE4C0EB8C1E3E0A9E988BCA0A34A6966DBF4A5CE5484667BDD14D213'],
        ['tests/firestore.invoiceV2.rules', '184B9AFB4B7BCE534FEF702E05E5444981EC130250C9685F75FEF8FEE0BBC3D6']]) {
        // Git may check out LF or CRLF: this workspace's approved files are LF.
        assert.equal(createHash('sha256').update(readFileSync(new URL('../' + file, import.meta.url))).digest('hex').toUpperCase(), expected);
    }
});
