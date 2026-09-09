import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authorizeAndPrepareInvoiceDraftUpdate as prepare, InvoiceDraftUpdateCommandError } from '../js/backend/invoiceDraftUpdateCommand.js';
import { authorizeAndPrepareInvoiceDraftCommand, InvoiceDraftCommandError } from '../js/backend/invoiceDraftCommand.js';
import { validateInvoiceDraft } from '../js/finance/invoiceDraftValidator.js';

const minimal = () => ({ currency: 'ZAR', lineItems: [] });
const line = () => ({ id: 'line-1', description: 'Consulting', quantity: '1.500', unitPriceMinor: 1000,
    discountMinor: 100, taxCode: 'STANDARD', taxRateBps: 1000, catalogItemId: null });
const candidate = () => ({ customerId: null, customerName: ' Customer 王 ', customerEmail: null,
    customerAddress: ' Street\r\nCity ', currency: 'ZAR', issueDate: null, dueDate: null, lineItems: [line()] });
// Independent persisted fixture; does not use the command or validator to create expected totals.
const stored = () => ({
    schemaVersion: 2, businessId: 'business-a', ownerId: 'user-a', lifecycleStatus: 'draft', paymentStatus: 'not_due',
    customer: { id: null, name: 'Customer 王', email: null, address: 'Street\nCity' },
    currency: 'ZAR', issueDate: null, dueDate: null,
    lineItems: [{ ...line(), subtotalMinor: 1500, taxMinor: 140, totalMinor: 1540 }],
    subtotalMinor: 1500, discountMinor: 100, taxMinor: 140, totalMinor: 1540, amountPaidMinor: 0, balanceDueMinor: 1540,
    createdBy: 'historical-user', updatedBy: 'user-a', createdAt: { seconds: 100, nanoseconds: 10 },
    updatedAt: { seconds: 101, nanoseconds: 0 }, revision: 4
});
const request = () => ({ authContext: { uid: 'user-a' }, businessContext: { businessId: 'business-a', ownerId: 'user-a', role: 'owner' },
    businessId: 'business-a', invoiceId: 'draft-1', expectedRevision: 4, storedInvoice: stored(), input: candidate() });
const rejects = (args, code, type = InvoiceDraftUpdateCommandError) => assert.throws(() => prepare(args), error => {
    assert.ok(error instanceof type); assert.equal(error.code, code); return true;
});
const corrupt = (label, mutate) => test(`stored corruption: ${label}`, () => {
    const args = request(); mutate(args.storedInvoice); rejects(args, 'INTERNAL');
});

test('owner prepares exact detached result with 4 → 5 and independently expected totals', () => {
    const args = request(), result = prepare(args);
    assert.deepEqual(result, { businessId: 'business-a', invoiceId: 'draft-1', ownerId: 'user-a', actorUid: 'user-a',
        expectedRevision: 4, previousRevision: 4, nextRevision: 5, draft: validateInvoiceDraft(args.input),
        preserved: { createdBy: 'historical-user', createdAt: { seconds: 100, nanoseconds: 10 } } });
    assert.deepEqual(result.draft.totals, { subtotalMinor: 1500, discountMinor: 100, taxMinor: 140, totalMinor: 1540 });
    assert.equal(result.draft.customerAddress, 'Street\nCity');
    assert.equal(result.updatedAt, undefined);
});
for (const value of [null, undefined]) test(`missing auth ${value} preserves Stage 9B`, () => {
    const args = request(); args.authContext = value; rejects(args, 'UNAUTHENTICATED', InvoiceDraftCommandError);
});
test('omitted auth preserves Stage 9B unauthenticated error', () => {
    const args = request(); delete args.authContext; rejects(args, 'UNAUTHENTICATED', InvoiceDraftCommandError);
});
for (const [label, change] of [
    ['wrong actor', a => { a.authContext.uid = 'user-b'; }],
    ['wrong owner', a => { a.businessContext.ownerId = 'user-b'; }]
]) test(label, () => { const args = request(); change(args); rejects(args, 'BUSINESS_ACCESS_DENIED', InvoiceDraftCommandError); });
for (const role of ['staff', 'accountant', 'viewer', 'Owner', 'OWNER', ' owner ']) test(`role ${role} preserves Stage 9B`, () => {
    const args = request(); args.businessContext.role = role; rejects(args, 'INVALID_BUSINESS_ROLE', InvoiceDraftCommandError);
});
for (const [field, code] of [['authContext', 'INVALID_AUTH_CONTEXT'], ['businessContext', 'INVALID_BUSINESS_CONTEXT']]) {
    test(`malformed ${field} retains existing domain error`, () => { const args = request(); args[field] = {}; rejects(args, code, InvoiceDraftCommandError); });
}
test('requested business cannot borrow another trusted context', () => {
    const args = request(); args.businessId = 'business-b'; rejects(args, 'BUSINESS_ACCESS_DENIED');
});
test('authorization precedes candidate and stored validation', () => {
    const args = request(); args.authContext.uid = 'user-b'; args.input = {}; args.storedInvoice = null;
    rejects(args, 'BUSINESS_ACCESS_DENIED', InvoiceDraftCommandError);
});
test('extra trusted claims never become authority or output', () => {
    const args = request(); args.authContext.role = 'staff'; args.businessContext.actorUid = 'victim';
    assert.equal(prepare(args).actorUid, 'user-a');
});
for (const key of ['uid', 'ownerId', 'role', 'revision', 'createdBy', 'updatedBy', 'data']) test(`top-level ${key} injection rejected`, () => {
    const args = request(); args[key] = 'victim'; rejects(args, 'INVALID_REQUEST');
});
for (const invoiceId of ['', 'a/b', '__reserved__', ' x', 'x\n', 'x\u2028', 'ａ', 'a'.repeat(129)]) test(`bad invoice route ${JSON.stringify(invoiceId)}`, () => {
    rejects({ ...request(), invoiceId }, 'INVALID_REQUEST');
});
for (const businessId of ['', '.', '..', 'a/b', '__x__', ' x', 'x\n', '\ud800', 'a'.repeat(129)]) test(`bad business route ${JSON.stringify(businessId)}`, () => {
    rejects({ ...request(), businessId }, 'INVALID_REQUEST');
});
test('Unicode business route is bound without rewriting', () => {
    const args = request(); args.businessId = args.businessContext.businessId = args.storedInvoice.businessId = '業'.repeat(128);
    assert.equal(prepare(args).businessId, args.businessId);
});
test('minimal full replacement clears previous optional content', () => {
    const args = request(); args.input = minimal(); const result = prepare(args);
    assert.deepEqual(result.draft, { customerId: null, customerName: '', customerEmail: null, customerAddress: null,
        currency: 'ZAR', issueDate: null, dueDate: null, lineItems: [], totals: { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 } });
});
test('incomplete and zero-price line drafts do not require issue readiness', () => {
    const args = request(); args.input.customerName = ''; args.input.lineItems[0].unitPriceMinor = 0; args.input.lineItems[0].discountMinor = 0;
    assert.equal(prepare(args).draft.totals.totalMinor, 0);
});
test('replacement recalculates changed price and tax instead of preserving stored totals', () => {
    const args = request(); args.input.lineItems[0].unitPriceMinor = 2000;
    assert.deepEqual(prepare(args).draft.totals, { subtotalMinor: 3000, discountMinor: 100, taxMinor: 290, totalMinor: 3190 });
});
test('line addition, removal and reorder follow candidate order', () => {
    const args = request(); args.input.lineItems = [{ ...line(), id: 'new' }, { ...line(), id: 'another' }];
    assert.deepEqual(prepare(args).draft.lineItems.map(l => l.id), ['new', 'another']);
});
for (const [label, mutate, domainCode] of [
    ['currency', d => { d.currency = 'USD'; }, 'INVALID_CURRENCY'],
    ['null name', d => { d.customerName = null; }, 'INVALID_CUSTOMER_NAME'],
    ['bad date', d => { d.issueDate = '2025-02-29'; }, 'INVALID_ISSUE_DATE'],
    ['bad email', d => { d.customerEmail = 'bad'; }, 'INVALID_CUSTOMER_EMAIL'],
    ['quantity', d => { d.lineItems[0].quantity = '0'; }, 'INVALID_QUANTITY'],
    ['discount', d => { d.lineItems[0].discountMinor = 1501; }, 'DISCOUNT_EXCEEDS_SUBTOTAL'],
    ['unsafe arithmetic', d => { d.lineItems[0].unitPriceMinor = Number.MAX_SAFE_INTEGER; }, 'UNSAFE_FINANCIAL_VALUE'],
    ['duplicate lines', d => { d.lineItems.push({ ...d.lineItems[0] }); }, 'DUPLICATE_LINE_ID']
]) test(`candidate Stage 8B ${label} preserved as domainCode`, () => {
    const args = request(); mutate(args.input);
    let original; try { authorizeAndPrepareInvoiceDraftCommand(args); } catch (error) { original = error; }
    assert.equal(original.code, domainCode);
    assert.throws(() => prepare(args), error => error.code === 'INVALID_INVOICE_DRAFT' && error.domainCode === original.code);
});
for (const field of ['uid', 'ownerId', 'role', 'authContext', 'businessContext', 'revision', 'schemaVersion', 'lifecycleStatus',
    'paymentStatus', 'subtotalMinor', 'discountMinor', 'taxMinor', 'totalMinor', 'amountPaidMinor', 'balanceDueMinor',
    'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'invoiceNumber', 'provider', 'paymentReference']) test(`candidate protected ${field}`, () => {
    const args = request(); args.input[field] = 'private-value'; rejects(args, 'INVALID_INVOICE_DRAFT');
});
test('line calculated fields cannot be supplied', () => {
    const args = request(); args.input.lineItems[0].totalMinor = 1; rejects(args, 'INVALID_INVOICE_DRAFT');
});
for (const ref of ['customer', 'catalog']) test(`candidate ${ref} reference unsupported`, () => {
    const args = request(); if (ref === 'customer') args.input.customerId = 'customer-a'; else args.input.lineItems[0].catalogItemId = 'item-a';
    rejects(args, 'REFERENCE_NOT_SUPPORTED');
});
test('blank reference remains draft validation error', () => {
    const args = request(); args.input.customerId = ' '; rejects(args, 'INVALID_INVOICE_DRAFT');
});
test('unknown field names and values do not leak through update errors', () => {
    const args = request(); args.input['private-address'] = 'secret';
    assert.throws(() => prepare(args), error => { assert.equal(error.path, undefined); assert.doesNotMatch(JSON.stringify(error), /private-address|secret/); return true; });
});

for (const [key, value] of [['schemaVersion', 1], ['schemaVersion', '2'], ['businessId', 'other'], ['ownerId', 'other'], ['ownerId', 42]])
    corrupt(`${key}=${value}`, s => { s[key] = value; });
for (const value of [undefined, null, '4', true, 4.5, 0, -1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])
    corrupt(`revision ${String(value)}`, s => { s.revision = value; });
for (const value of [undefined, null, '', 1, 'Draft', ' draft', 'draft\n', 'draft\u2028', 'a'.repeat(65)])
    corrupt(`lifecycle ${JSON.stringify(value)}`, s => { s.lifecycleStatus = value; });
for (const lifecycleStatus of ['issued', 'cancelled', 'future_state']) test(`${lifecycleStatus} is not editable before draft schema validation`, () => {
    const args = request(); args.storedInvoice = { schemaVersion: 2, businessId: 'business-a', ownerId: 'user-a', revision: 4, lifecycleStatus };
    args.expectedRevision = 3; rejects(args, 'INVOICE_NOT_EDITABLE');
});
test('common corruption precedes non-draft eligibility', () => {
    const args = request(); args.storedInvoice.lifecycleStatus = 'issued'; args.storedInvoice.revision = '4'; rejects(args, 'INTERNAL');
});
for (const key of Object.keys(stored())) corrupt(`missing ${key}`, s => { delete s[key]; });
for (const key of ['extra', 'invoiceNumber', 'issuedAt', 'cancelledAt', 'paidAt', 'paymentId', 'paymentReference',
    'paymentProvider', 'providerTransactionId', 'allocations', 'refunds', 'credits', 'financialEvents'])
    corrupt(`unexpected ${key}`, s => { s[key] = null; });
for (const value of [null, [], 'invoice', new Date(0), Object.create({ schemaVersion: 2 })]) test('non-plain/missing stored invoice is internal', () => {
    rejects({ ...request(), storedInvoice: value }, 'INTERNAL');
});
corrupt('customer array', s => { s.customer = []; });
corrupt('missing customer name', s => { delete s.customer.name; });
corrupt('unknown customer key', s => { s.customer.extra = true; });
corrupt('stored customer reference', s => { s.customer.id = 'customer-a'; });
corrupt('stored catalog reference', s => { s.lineItems[0].catalogItemId = 'item-a'; });
corrupt('missing line input', s => { delete s.lineItems[0].taxCode; });
corrupt('missing calculated line field', s => { delete s.lineItems[0].subtotalMinor; });
corrupt('unknown line field', s => { s.lineItems[0].extra = 1; });
corrupt('null line', s => { s.lineItems[0] = null; });
corrupt('sparse line array', s => { s.lineItems = Array(1); });
corrupt('extra array property', s => { s.lineItems.extra = true; });
corrupt('101 stored lines', s => { s.lineItems = Array(101).fill(s.lineItems[0]); });
corrupt('unnormalized name', s => { s.customer.name = ' Customer 王 '; });
corrupt('unnormalized address', s => { s.customer.address = 'Street\r\nCity'; });
corrupt('unnormalized line description', s => { s.lineItems[0].description = ' Consulting '; });
corrupt('invalid stored date', s => { s.issueDate = '2026-02-30'; });
corrupt('invalid stored email', s => { s.customer.email = 'bad'; });
for (const [field, value] of [['currency', 'USD'], ['paymentStatus', 'paid'], ['amountPaidMinor', 1], ['amountPaidMinor', '0'], ['balanceDueMinor', 0]])
    corrupt(`financial ${field}`, s => { s[field] = value; });
for (const field of ['subtotalMinor', 'discountMinor', 'taxMinor', 'totalMinor']) {
    corrupt(`aggregate ${field}`, s => { s[field] += 1; });
    corrupt(`aggregate ${field} string`, s => { s[field] = String(s[field]); });
}
for (const field of ['subtotalMinor', 'taxMinor', 'totalMinor']) corrupt(`line calculated ${field}`, s => { s.lineItems[0][field] += 1; });
corrupt('unsafe stored money', s => { s.lineItems[0].unitPriceMinor = Number.MAX_SAFE_INTEGER + 1; });
test('stored corruption is internal before stale revision, never repaired by minimal replacement', () => {
    const args = request(); args.storedInvoice.totalMinor = 0; args.expectedRevision = 3; args.input = minimal(); rejects(args, 'INTERNAL');
});

for (const key of ['createdBy', 'updatedBy']) for (const value of ['', ' user', 'user\n', null, 1, '\ud800', 'x'.repeat(129)])
    corrupt(`${key} ${JSON.stringify(value)}`, s => { s[key] = value; });
for (const key of ['createdAt', 'updatedAt']) for (const value of [null, 1, new Date(0), {}, { seconds: 100 },
    { seconds: '100', nanoseconds: 0 }, { seconds: 1.5, nanoseconds: 0 }, { seconds: -62135596801, nanoseconds: 0 },
    { seconds: 253402300800, nanoseconds: 0 }, { seconds: 100, nanoseconds: -1 }, { seconds: 100, nanoseconds: 1e9 },
    { seconds: 100, nanoseconds: 0.5 }, { seconds: 100, nanoseconds: 0, extra: true }])
    corrupt(`${key} ${JSON.stringify(value)}`, s => { s[key] = value; });
corrupt('updated seconds before creation', s => { s.updatedAt.seconds = 99; });
corrupt('updated nanos before creation', s => { s.updatedAt = { seconds: 100, nanoseconds: 9 }; });
test('equal audit timestamps are valid and historical actor preserved', () => {
    const args = request(); args.storedInvoice.updatedAt = { ...args.storedInvoice.createdAt };
    assert.deepEqual(prepare(args).preserved, { createdBy: 'historical-user', createdAt: { seconds: 100, nanoseconds: 10 } });
});
test('timestamp range endpoints and nanosecond precision preserved without a clock', () => {
    const args = request(); args.storedInvoice.createdAt = { seconds: -62135596800, nanoseconds: 0 };
    args.storedInvoice.updatedAt = { seconds: 253402300799, nanoseconds: 999999999 };
    assert.deepEqual(prepare(args).preserved.createdAt, args.storedInvoice.createdAt);
});
test('stale 5 / expected 4 conflicts without exposing current revision', () => {
    const args = request(); args.storedInvoice.revision = 5;
    assert.throws(() => prepare(args), error => {
        assert.equal(error.code, 'INVOICE_REVISION_CONFLICT'); assert.equal(error.currentRevision, undefined);
        assert.equal(error.revision, undefined); return true;
    });
});
test('synthetic snapshot advance invalidates second preparation; not a transaction test', () => {
    const a = request(), b = request(); const first = prepare(a);
    b.storedInvoice.revision = first.nextRevision; rejects(b, 'INVOICE_REVISION_CONFLICT');
    assert.equal(prepare(a).nextRevision, 5); // Pure calls do not lock or persist.
});
test('identical normalized content still advances once', () => {
    const args = request(); args.input.customerName = args.storedInvoice.customer.name; args.input.customerAddress = args.storedInvoice.customer.address;
    assert.equal(prepare(args).nextRevision, 5);
});
test('matching MAX_SAFE_INTEGER fails internal', () => {
    const args = request(); args.expectedRevision = args.storedInvoice.revision = Number.MAX_SAFE_INTEGER; rejects(args, 'INTERNAL');
});
test('stale against MAX_SAFE_INTEGER conflicts before overflow', () => {
    const args = request(); args.storedInvoice.revision = Number.MAX_SAFE_INTEGER; rejects(args, 'INVOICE_REVISION_CONFLICT');
});
test('penultimate safe revision increments to maximum exactly', () => {
    const args = request(); args.expectedRevision = args.storedInvoice.revision = Number.MAX_SAFE_INTEGER - 1;
    assert.equal(prepare(args).nextRevision, Number.MAX_SAFE_INTEGER);
});
for (const expectedRevision of [undefined, null, '4', true, 1.5, 0, -1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) test(`bad precondition ${String(expectedRevision)}`, () => {
    rejects({ ...request(), expectedRevision }, 'INVALID_REQUEST');
});
test('missing expectedRevision is invalid request', () => { const args = request(); delete args.expectedRevision; rejects(args, 'INVALID_REQUEST'); });

function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
test('all contexts, stored snapshot and candidate remain unchanged, including frozen nesting', () => {
    const args = request(), before = structuredClone(args); freeze(args); prepare(args); assert.deepEqual(args, before);
});
test('later caller mutations cannot change prepared content or preservation evidence', () => {
    const args = request(), result = prepare(args), before = structuredClone(result);
    args.authContext.uid = 'victim'; args.businessContext.ownerId = 'victim'; args.input.customerName = 'changed';
    args.input.lineItems[0].unitPriceMinor = 4; args.input.lineItems.push(line());
    args.storedInvoice.createdAt.seconds = 0; args.storedInvoice.customer.name = 'changed';
    assert.deepEqual(result, before);
});
test('mutating returned data cannot mutate any supplied snapshot', () => {
    const args = request(), before = structuredClone(args), result = prepare(args);
    result.preserved.createdAt.seconds = 0; result.draft.lineItems[0].description = 'changed'; result.draft.totals.totalMinor = 0;
    assert.deepEqual(args, before);
});
test('stored getters are rejected without execution', () => {
    for (const location of ['root', 'customer', 'line', 'timestamp', 'array']) {
        const args = request(); let calls = 0;
        const [object, key] = location === 'root' ? [args.storedInvoice, 'revision'] : location === 'customer' ? [args.storedInvoice.customer, 'name']
            : location === 'line' ? [args.storedInvoice.lineItems[0], 'quantity'] : location === 'timestamp' ? [args.storedInvoice.createdAt, 'seconds'] : [args.storedInvoice.lineItems, '0'];
        Object.defineProperty(object, key, { enumerable: true, get() { calls++; return 4; } });
        rejects(args, 'INTERNAL'); assert.equal(calls, 0);
    }
});
test('candidate getters retain Stage 8B rejection without execution', () => {
    const args = request(); let calls = 0;
    Object.defineProperty(args.input, 'customerName', { get() { calls++; return 'name'; } });
    rejects(args, 'INVALID_INVOICE_DRAFT'); assert.equal(calls, 0);
});
test('plain null-prototype records accepted', () => {
    const args = request(); Object.setPrototypeOf(args.storedInvoice, null); Object.setPrototypeOf(args.storedInvoice.customer, null);
    assert.equal(prepare(args).nextRevision, 5);
});
test('symbol and inherited stored fields fail closed', () => {
    const args = request(); args.storedInvoice[Symbol('extra')] = true; rejects(args, 'INTERNAL');
    args.storedInvoice = Object.create(stored()); rejects(args, 'INTERNAL');
});
test('portable dependency graph contains only domain modules', () => {
    const source = readFileSync(new URL('../js/backend/invoiceDraftUpdateCommand.js', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1]);
    assert.deepEqual(imports, ['./invoiceDraftCommand.js', '../finance/invoiceDraftValidator.js']);
    assert.doesNotMatch(source, /\b(?:fetch|Date|setTimeout|XMLHttpRequest)\s*[.(]|firebase-admin|firebase-functions|invoiceIssueValidator|node:/);
});
