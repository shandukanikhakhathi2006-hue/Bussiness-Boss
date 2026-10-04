import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decimalToMinor, minorToDecimal, rand, formToDraft, draftToForm } from '../js/features/invoiceDraftForm.js';
import { createInvoiceDraftWorkflow, safeDraftError } from '../js/features/invoiceDraftWorkflow.js';
import { calculateInvoiceTotals } from '../js/finance/invoiceCalculations.js';

const environment = { local: true, projectId: 'demo-businessboss-rules' };
const productionEnvironment = { local: false, projectId: 'business-boss-1b871' };
const businessId = 'stage9n-demo-business';
const error = code => ({ details: { code }, message: 'private raw server paths tokens stack' });
const draft = () => ({ customerId: null, customerName: 'Customer', customerEmail: null, customerAddress: null,
    currency: 'ZAR', issueDate: null, dueDate: null, lineItems: ['b', 'a'].map(id => ({ id, description: 'Service', quantity: '1.500',
        unitPriceMinor: 1050, discountMinor: 0, taxCode: 'VAT', taxRateBps: 1500, catalogItemId: null })) });
const loaded = (revision = 7, invoiceId = 'existing', input = draft()) => ({ invoiceId, lifecycleStatus: 'draft', revision,
    draft: input, totals: calculateInvoiceTotals(input.lineItems) });
function fixture(overrides = {}) {
    const calls = []; let id = 0, server = loaded();
    const api = {
        async getInvoiceDraft(data) { calls.push(['get', structuredClone(data)]); return structuredClone(server); },
        async saveInvoiceDraft(data) { calls.push(['create', structuredClone(data)]); server = loaded(1, data.invoiceId, { ...data.draft, customerName: data.draft.customerName.trim() }); return { invoiceId: data.invoiceId, lifecycleStatus: 'draft' }; },
        async updateInvoiceDraft(data) { calls.push(['update', structuredClone(data)]); server = loaded(server.revision + 1, data.invoiceId, data.input); return { invoiceId: data.invoiceId, revision: server.revision }; },
        ...overrides
    };
    const changes = [];
    const editor = createInvoiceDraftWorkflow({ environment, businessId, api, makeId: () => `generated-${++id}`, onChange: state => changes.push(state) });
    return { editor, api, calls, changes, server: () => server, setServer: value => { server = value; } };
}

test('workflow preserves invoice behavior in the production environment', () => {
    const calls = [];
    const api = { getInvoiceDraft: async () => loaded(), saveInvoiceDraft: async () => ({ invoiceId: 'generated-1', lifecycleStatus: 'draft' }), updateInvoiceDraft: async () => ({ invoiceId: 'existing', revision: 8 }) };
    const editor = createInvoiceDraftWorkflow({ environment: productionEnvironment, businessId: 'production-business', api, makeId: () => 'generated-1', onChange: () => calls.push(true) });
    assert.equal(editor.newDraft(), true); assert.equal(editor.snapshot().businessId, 'production-business');
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

for (const [text, minor] of [['0', 0], ['0.01', 1], ['1.00', 100], ['10.50', 1050], ['1000.99', 100099], ['90071992547409.91', Number.MAX_SAFE_INTEGER]]) {
    test(`exact decimal conversion ${text}`, () => { assert.equal(decimalToMinor(text), minor); assert.equal(decimalToMinor(minorToDecimal(minor)), minor); });
}
for (const text of ['', ' 1', '1 ', '1,000.00', 'R 1.00', '-1', '1e2', '1.001', '.01', 'NaN', 'Infinity', '90071992547409.92', '01', 1]) {
    test(`reject malformed/unsafe money ${JSON.stringify(text)}`, () => assert.throws(() => decimalToMinor(text)));
}
test('tax percentages use exact same scale and display remains exact', () => {
    assert.equal(decimalToMinor('15'), 1500); assert.equal(decimalToMinor('0.01'), 1);
    assert.equal(minorToDecimal(1500), '15.00'); assert.equal(rand(125000), 'R 1,250.00');
});
test('create uses generated ID, exact draft, then adopts normalized trusted read, never local revision', async () => {
    const f = fixture(); f.editor.newDraft();
    const initial = f.editor.snapshot(); assert.equal(initial.invoiceId, 'generated-1'); assert.equal(initial.revision, null);
    f.editor.edit('customerName', ' Customer '); f.editor.edit('description', 'Service', initial.form.lineItems[0].id);
    const expected = formToDraft(f.editor.snapshot().form);
    assert.equal(await f.editor.save(), true);
    assert.deepEqual(f.calls, [['create', { businessId, invoiceId: initial.invoiceId, draft: expected }], ['get', { businessId, invoiceId: initial.invoiceId }]]);
    const state = f.editor.snapshot(); assert.equal(state.revision, 1); assert.equal(state.form.customerName, 'Customer');
    assert.deepEqual(state.totals, f.server().totals); assert.equal(state.draft.totals, undefined);
    assert.equal(f.changes.some(state => state.busy && state.revision !== null), false);
});
test('create success/read failure never fabricates revision or re-creates on Save', async () => {
    const f = fixture({ getInvoiceDraft: async () => { throw error('UNAVAILABLE'); } }); f.editor.newDraft();
    assert.equal(await f.editor.save(), false); assert.equal(f.editor.snapshot().revision, null);
    assert.equal(f.editor.snapshot().needsReload, true); assert.equal(f.editor.snapshot().canSave, false);
    await f.editor.save(); assert.equal(f.calls.length, 1);
});
test('duplicate create conflict keeps ID/form; only New generates another ID', async () => {
    const f = fixture({ saveInvoiceDraft: async () => { throw error('INVOICE_ALREADY_EXISTS'); } }); f.editor.newDraft();
    const before = f.editor.snapshot(); await f.editor.save();
    assert.equal(f.editor.snapshot().invoiceId, before.invoiceId); assert.deepEqual(f.editor.snapshot().form, before.form);
    assert.equal(f.editor.snapshot().revision, null); assert.equal(f.editor.snapshot().canSave, false);
    f.editor.newDraft(); assert.notEqual(f.editor.snapshot().invoiceId, before.invoiceId);
});
test('load uses only routing fields, retains quantity/order and revision', async () => {
    const f = fixture(); await f.editor.load('existing');
    assert.deepEqual(f.calls, [['get', { businessId, invoiceId: 'existing' }]]);
    const state = f.editor.snapshot(); assert.equal(state.revision, 7);
    assert.deepEqual(state.form.lineItems.map(line => line.id), ['b', 'a']); assert.equal(state.form.lineItems[0].quantity, '1.500');
});
test('load does not replace current form/revision until success; duplicate load and edits blocked', async () => {
    const f = fixture(); await f.editor.load('existing'); const before = f.editor.snapshot();
    const pending = deferred(); f.api.getInvoiceDraft = () => pending.promise;
    const operation = f.editor.load('another');
    assert.equal(await f.editor.load('third'), false); assert.equal(f.editor.edit('customerName', 'rejected'), false);
    assert.deepEqual(f.editor.snapshot().form, before.form);
    pending.resolve(loaded(8, 'another')); await operation; assert.equal(f.editor.snapshot().invoiceId, 'another');
});
test('failed replacement load preserves old content but disables editing as stale', async () => {
    const f = fixture(); await f.editor.load('existing'); const before = f.editor.snapshot();
    f.api.getInvoiceDraft = async () => { throw error('INVOICE_NOT_FOUND'); }; await f.editor.load('missing');
    assert.deepEqual(f.editor.snapshot().form, before.form); assert.equal(f.editor.snapshot().revision, 7);
    assert.equal(f.editor.snapshot().canEdit, false); assert.equal(f.editor.snapshot().status, 'error');
});
test('add/remove/edit preserve stable IDs/order, raw strings and revision', async () => {
    const f = fixture(); await f.editor.load('existing'); f.editor.addLine();
    const last = f.editor.snapshot().form.lineItems.at(-1).id; assert.notEqual(last, '2');
    f.editor.edit('quantity', '2.500', 'a'); f.editor.removeLine('b');
    assert.deepEqual(f.editor.snapshot().form.lineItems.map(line => line.id), ['a', last]);
    assert.equal(f.editor.snapshot().form.lineItems[0].quantity, '2.500'); assert.equal(f.editor.snapshot().revision, 7);
});
test('protected fields cannot be edited or enter complete request projection; nullable dates and references', async () => {
    const f = fixture(); await f.editor.load('existing');
    for (const field of ['uid', 'ownerId', 'role', 'idToken', 'totals', 'revision', 'invoiceNumber', 'currency']) assert.equal(f.editor.edit(field, 'evil'), false);
    const form = f.editor.snapshot().form; form.uid = 'evil'; form.lineItems[0].totalMinor = 999;
    const input = formToDraft(form); assert.deepEqual(input, draft());
    assert.equal(input.customerId, null); assert.equal(input.lineItems[0].catalogItemId, null); assert.equal(input.issueDate, null);
});
test('update uses full current draft and revision, reads back, second update uses new server revision', async () => {
    const f = fixture(); await f.editor.load('existing'); f.editor.edit('customerName', 'Edited');
    const input = formToDraft(f.editor.snapshot().form); assert.equal(await f.editor.save(), true);
    assert.deepEqual(f.calls[1], ['update', { businessId, invoiceId: 'existing', expectedRevision: 7, input }]);
    assert.equal(f.calls[2][0], 'get'); assert.equal(f.editor.snapshot().revision, 8);
    assert.equal(f.editor.snapshot().dirty, false); assert.deepEqual(f.editor.snapshot().totals, f.server().totals);
    f.editor.edit('customerName', 'Again'); await f.editor.save(); assert.equal(f.calls[3][1].expectedRevision, 8); assert.equal(f.editor.snapshot().revision, 9);
});
test('in-flight Save locks duplicate Save, New, Load, add/remove and editing until readback completes', async () => {
    const f = fixture(); await f.editor.load('existing'); const pending = deferred();
    f.api.updateInvoiceDraft = () => pending.promise; const operation = f.editor.save();
    assert.equal(await f.editor.save(), false); assert.equal(f.editor.newDraft(), false); assert.equal(await f.editor.load('other'), false);
    assert.equal(f.editor.addLine(), false); assert.equal(f.editor.removeLine('a'), false); assert.equal(f.editor.edit('customerName', 'rejected'), false);
    const read = deferred(); f.api.getInvoiceDraft = () => read.promise; pending.resolve({ invoiceId: 'existing', revision: 8 });
    await Promise.resolve(); assert.equal(f.editor.snapshot().busy, true); assert.equal(f.editor.snapshot().revision, 8);
    read.resolve(loaded(8)); await operation; assert.equal(f.editor.snapshot().canSave, true);
});
test('conflict preserves unsaved form and revision, never retries/reads until explicit reload', async () => {
    const f = fixture(); await f.editor.load('existing'); f.editor.edit('customerName', 'Unsaved');
    let updates = 0; f.api.updateInvoiceDraft = async () => { updates++; throw error('INVOICE_REVISION_CONFLICT'); };
    const before = f.editor.snapshot(); await f.editor.save(); await f.editor.save();
    assert.equal(updates, 1); assert.equal(f.calls.length, 1); assert.equal(f.editor.snapshot().revision, 7);
    assert.deepEqual(f.editor.snapshot().form, before.form); assert.equal(f.editor.snapshot().status, 'conflict');
    assert.equal(await f.editor.reload(), false); assert.deepEqual(f.editor.snapshot().form, before.form);
    f.setServer(loaded(9)); assert.equal(await f.editor.reload(true), true); assert.equal(f.editor.snapshot().revision, 9);
    assert.equal(f.editor.snapshot().form.customerName, 'Customer');
});
for (const revision of [7, 9]) test(`post-save read mismatch ${revision} preserves form and committed revision, blocks Save`, async () => {
    const f = fixture(); await f.editor.load('existing'); f.editor.edit('customerName', 'Local');
    f.api.getInvoiceDraft = async () => loaded(revision);
    assert.equal(await f.editor.save(), false); assert.equal(f.editor.snapshot().revision, 8);
    assert.equal(f.editor.snapshot().form.customerName, 'Local'); assert.equal(f.editor.snapshot().status, 'conflict'); assert.equal(f.editor.snapshot().canSave, false);
});
test('post-update read failure preserves committed revision but requires reload', async () => {
    const f = fixture(); await f.editor.load('existing'); f.editor.edit('customerName', 'Local');
    f.api.getInvoiceDraft = async () => { throw error('UNAVAILABLE'); }; await f.editor.save();
    assert.equal(f.editor.snapshot().revision, 8); assert.equal(f.editor.snapshot().needsReload, true); assert.equal(f.editor.snapshot().busy, false);
    assert.match(f.editor.snapshot().feedback.message, /save completed/);
});
test('uncertain network write failure requires reload without assuming success or changing revision', async () => {
    const f = fixture(); await f.editor.load('existing'); f.api.updateInvoiceDraft = async () => { throw error('UNAVAILABLE'); };
    await f.editor.save(); assert.equal(f.editor.snapshot().revision, 7); assert.equal(f.editor.snapshot().canSave, false);
    assert.match(f.editor.snapshot().feedback.message, /could not be confirmed/);
});
for (const code of ['UNAUTHENTICATED', 'BUSINESS_ACCESS_DENIED', 'BUSINESS_NOT_FOUND', 'BUSINESS_INACTIVE', 'INVALID_BUSINESS_ROLE', 'INVOICE_NOT_FOUND', 'INVOICE_NOT_EDITABLE', 'INVALID_REQUEST', 'INVALID_INVOICE_DRAFT', 'REFERENCE_NOT_SUPPORTED', 'UNAVAILABLE', 'INTERNAL']) {
    test(`safe ${code} state preserves content and exits busy`, async () => {
        const f = fixture(); await f.editor.load('existing'); f.editor.edit('customerName', 'Unsaved');
        f.api.updateInvoiceDraft = async () => { throw error(code); }; await f.editor.save();
        assert.equal(f.editor.snapshot().feedback.code, code); assert.doesNotMatch(f.editor.snapshot().feedback.message, /private|tokens|stack|paths/);
        assert.equal(f.editor.snapshot().form.customerName, 'Unsaved'); assert.equal(f.editor.snapshot().busy, false);
        if (code === 'INVOICE_NOT_EDITABLE') assert.equal(f.editor.snapshot().canEdit, false);
    });
}
test('safe field feedback accepts only approved paths, never raw details', () => {
    assert.equal(safeDraftError({ details: { code: 'INVALID_INVOICE_DRAFT', path: 'lineItems[1].unitPriceMinor' } }).message, 'Please check line 2 unit price.');
    const result = safeDraftError({ details: { code: 'INVALID_INVOICE_DRAFT', path: 'private/customer-secret' }, message: 'token' });
    assert.equal(result.path, null); assert.doesNotMatch(result.message, /private|secret|token/);
    assert.equal(safeDraftError({ code: 'functions/unauthenticated' }).code, 'UNAUTHENTICATED');
});
test('malformed money remains controlled text; save makes no request and flags its field', async () => {
    const f = fixture(); await f.editor.load('existing'); f.editor.edit('unitPrice', '0.001', 'b');
    await f.editor.save(); assert.equal(f.calls.length, 1); assert.equal(f.editor.snapshot().form.lineItems[0].unitPrice, '0.001');
    assert.equal(f.editor.snapshot().feedback.path, 'lineItems[0].unitPriceMinor'); assert.equal(f.editor.snapshot().preview, null);
});
test('dispose prevents a late response from changing state or notifying another session', async () => {
    const pending = deferred(); const f = fixture({ getInvoiceDraft: () => pending.promise });
    const operation = f.editor.load('existing'); f.editor.dispose(); const count = f.changes.length;
    pending.resolve(loaded()); await operation; assert.equal(f.editor.snapshot().revision, null); assert.equal(f.changes.length, count);
});
test('workflow refuses non-demo/local environments before calling APIs', () => {
    for (const env of [{ local: false }, { local: true, projectId: 'production' }]) assert.throws(() => createInvoiceDraftWorkflow({ environment: env, businessId, api: {} }));
});
test('unknown route and malformed loaded revision never invent state', async () => {
    const f = fixture({ getInvoiceDraft: async () => loaded(undefined) });
    assert.equal(await f.editor.load('../legacy'), false);
    f.api.getInvoiceDraft = async () => ({ ...loaded(), revision: undefined }); await f.editor.load('existing');
    assert.equal(f.editor.snapshot().revision, null); assert.equal(f.editor.snapshot().status, 'error');
});
