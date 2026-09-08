import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authorizeAndPrepareInvoiceDraftCommand as prepare, InvoiceDraftCommandError } from '../js/backend/invoiceDraftCommand.js';
import { validateInvoiceDraft, InvoiceDraftValidationError } from '../js/finance/invoiceDraftValidator.js';
import { InvoiceCalculationError } from '../js/finance/invoiceCalculations.js';

const auth = () => ({ uid: 'user-a' });
const business = () => ({ businessId: 'business-123', ownerId: 'user-a', role: 'owner' });
const minimal = () => ({ currency: 'ZAR', lineItems: [] });
const line = extra => ({ id: 'line-1', description: ' Consulting ', quantity: '1.500', unitPriceMinor: 1000, discountMinor: 100, taxRateBps: 1000, taxCode: 'STANDARD', ...extra });
const full = () => ({ customerId: ' customer-1 ', customerName: ' Customer 王 ', customerEmail: ' customer@example.test ', customerAddress: ' Street\r\nCity ', currency: 'ZAR', issueDate: '2026-09-08', dueDate: '2026-09-30', lineItems: [line()] });
const command = extra => ({ authContext: auth(), businessContext: business(), input: minimal(), ...extra });
const expectCode = (request, code) => assert.throws(() => prepare(request), error => error instanceof InvoiceDraftCommandError && error.name === 'InvoiceDraftCommandError' && error.code === code && Boolean(error.message));
const capture = callback => { try { callback(); } catch (error) { return error; } assert.fail('Expected an error'); };

test('authorized owner returns exactly trusted metadata plus Stage 8B minimal draft', () => {
    assert.deepEqual(prepare(command()), { businessId: 'business-123', ownerId: 'user-a', actorUid: 'user-a', draft: validateInvoiceDraft(minimal()) });
});
test('full draft is normalized and calculated exclusively by Stage 8B', () => {
    const input = full();
    const result = prepare(command({ input }));
    assert.deepEqual(result.draft, validateInvoiceDraft(input));
    assert.equal(result.draft.totals.totalMinor, 1540);
    assert.equal(result.draft.customerName, 'Customer 王');
});
test('drafts do not require issue readiness, customer identity or a positive total', () => {
    const result = prepare(command()).draft;
    assert.equal(result.customerId, null);
    assert.equal(result.customerName, '');
    assert.equal(result.issueDate, null);
    assert.equal(result.dueDate, null);
    assert.equal(result.totals.totalMinor, 0);
});
for (const value of [null, undefined]) test(`auth ${value} is unauthenticated`, () => expectCode(command({ authContext: value }), 'UNAUTHENTICATED'));
test('omitted command/auth is unauthenticated', () => assert.throws(() => prepare(), error => error.code === 'UNAUTHENTICATED'));
for (const [label, context] of [['empty', {}], ['array', []], ['string', 'user-a'], ['number', 1], ['date', new Date(0)], ['inherited uid', Object.create({ uid: 'user-a' })]]) {
    test(`invalid auth context: ${label}`, () => expectCode(command({ authContext: context }), 'INVALID_AUTH_CONTEXT'));
}
const invalidIds = [['undefined', undefined], ['null', null], ['empty', ''], ['blank', '   '], ['leading space', ' user-a'], ['trailing space', 'user-a '], ['number', 4], ['boolean', true], ['object', {}], ['array', []], ['control', 'user\na'], ['C1 control', 'user\u0085a'], ['too long', 'a'.repeat(129)]];
for (const [label, uid] of invalidIds) test(`invalid uid: ${label}`, () => expectCode(command({ authContext: { uid } }), 'INVALID_AUTH_CONTEXT'));
for (const [label, context] of [['undefined', undefined], ['null', null], ['empty', {}], ['array', []], ['string', 'business-123'], ['number', 1], ['date', new Date(0)], ['inherited', Object.create(business())]]) {
    test(`invalid business context: ${label}`, () => expectCode(command({ businessContext: context }), 'INVALID_BUSINESS_CONTEXT'));
}
for (const field of ['businessId', 'ownerId', 'role']) test(`missing business ${field}`, () => {
    const context = business(); delete context[field];
    expectCode(command({ businessContext: context }), 'INVALID_BUSINESS_CONTEXT');
});
for (const field of ['businessId', 'ownerId']) {
    for (const [label, value] of invalidIds) test(`invalid ${field}: ${label}`, () => expectCode(command({ businessContext: { ...business(), [field]: value } }), 'INVALID_BUSINESS_CONTEXT'));
}
for (const businessId of ['.', '..', 'business/child', '/business']) test(`businessId rejects path ${businessId}`, () => expectCode(command({ businessContext: { ...business(), businessId } }), 'INVALID_BUSINESS_CONTEXT'));
test('another authenticated user is denied', () => expectCode(command({ authContext: { uid: 'user-b' } }), 'BUSINESS_ACCESS_DENIED'));
test('different trusted ownerId is denied', () => expectCode(command({ businessContext: { ...business(), ownerId: 'user-b' } }), 'BUSINESS_ACCESS_DENIED'));
test('ownership matching is case sensitive', () => expectCode(command({ authContext: { uid: 'USER-A' } }), 'BUSINESS_ACCESS_DENIED'));
for (const role of ['viewer', 'staff', 'accountant', 'admin', 'Owner', ' owner ', '', null, undefined, 1, ['owner']]) {
    test(`only exact owner role allowed: ${JSON.stringify(role)}`, () => expectCode(command({ businessContext: { ...business(), role } }), 'INVALID_BUSINESS_ROLE'));
}
for (const field of ['uid', 'businessId', 'ownerId', 'role']) test(`trusted context ${field} accessor is rejected without running it`, () => {
    let invoked = false;
    const authContext = auth(), businessContext = business();
    Object.defineProperty(field === 'uid' ? authContext : businessContext, field, { get() { invoked = true; return 'owner'; } });
    expectCode(command({ authContext, businessContext }), field === 'uid' ? 'INVALID_AUTH_CONTEXT' : 'INVALID_BUSINESS_CONTEXT');
    assert.equal(invoked, false);
});
test('null-prototype trusted data contexts work', () => {
    assert.deepEqual(prepare(command({ authContext: Object.assign(Object.create(null), auth()), businessContext: Object.assign(Object.create(null), business()) })), prepare(command()));
});
test('extra trusted claims are ignored and never forwarded', () => {
    assert.deepEqual(prepare(command({ authContext: { ...auth(), token: { admin: true } }, businessContext: { ...business(), plan: 'paid', secret: 'not-output' } })), prepare(command()));
});
for (const id of ['a'.repeat(128), '王'.repeat(128), '😀'.repeat(128)]) test(`128-code-point identities work: ${id.slice(0, 2)}`, () => {
    const result = prepare(command({ authContext: { uid: id }, businessContext: { businessId: id, ownerId: id, role: 'owner' } }));
    assert.equal(result.actorUid, id);
    assert.equal(result.businessId, id);
});
test('a second matching owner/business is accepted without hardcoded IDs', () => {
    assert.equal(prepare(command({ authContext: { uid: 'user-b' }, businessContext: { businessId: 'business-456', ownerId: 'user-b', role: 'owner' } })).actorUid, 'user-b');
});
for (const field of ['businessId', 'ownerId', 'uid', 'actorUid', 'role', 'authContext', 'businessContext', 'invoiceNumber', 'revision', 'status', 'paymentStatus', 'totalMinor', 'amountPaidMinor', 'balanceDueMinor', 'createdAt', 'updatedAt', 'issuedAt', 'paidAt', 'provider', 'paymentReference', 'verifiedAt', 'schemaVersion', 'totals']) {
    test(`client injection of ${field} is rejected, never stripped`, () => {
        const error = capture(() => prepare(command({ input: { ...minimal(), [field]: field === 'ownerId' ? 'user-a' : 'forged' } })));
        assert.ok(error instanceof InvoiceDraftValidationError);
        assert.equal(error.code, 'UNKNOWN_DRAFT_FIELD');
        assert.equal(error.path, `draft.${field}`);
    });
}
for (const [label, input] of [['null', null], ['missing', undefined], ['currency', { ...minimal(), currency: 'USD' }], ['date', { ...minimal(), issueDate: '2026-02-30' }], ['quantity', { ...minimal(), lineItems: [line({ quantity: '0' })] }], ['overflow', { ...minimal(), lineItems: [line({ unitPriceMinor: Number.MAX_SAFE_INTEGER })] }], ['nested authoritative field', { ...minimal(), lineItems: [line({ totalMinor: 999 })] }]]) {
    test(`Stage 8B detailed error preserved: ${label}`, () => {
        const expected = capture(() => validateInvoiceDraft(input));
        const actual = capture(() => prepare(command({ input })));
        assert.ok(actual instanceof InvoiceDraftValidationError);
        assert.ok(!(actual instanceof InvoiceDraftCommandError));
        for (const key of ['name', 'code', 'path', 'message']) assert.equal(actual[key], expected[key]);
        if (expected.cause) {
            assert.ok(actual.cause instanceof InvoiceCalculationError);
            assert.equal(actual.cause.code, expected.cause.code);
        }
    });
}
test('unauthenticated errors precede business and draft errors', () => expectCode({ authContext: null, businessContext: null, input: null }, 'UNAUTHENTICATED'));
test('business shape errors precede invalid input', () => expectCode(command({ businessContext: null, input: null }), 'INVALID_BUSINESS_CONTEXT'));
test('ownership errors precede role and draft errors', () => expectCode(command({ businessContext: { ...business(), ownerId: 'user-b', role: 'staff' }, input: null }), 'BUSINESS_ACCESS_DENIED'));
test('role errors precede draft errors', () => expectCode(command({ businessContext: { ...business(), role: 'staff' }, input: null }), 'INVALID_BUSINESS_ROLE'));
test('frozen contexts and nested draft remain unchanged; results are deterministic and independent', () => {
    const input = full(); input.lineItems = Object.freeze(input.lineItems.map(Object.freeze)); Object.freeze(input);
    const request = Object.freeze(command({ authContext: Object.freeze(auth()), businessContext: Object.freeze(business()), input }));
    const snapshot = JSON.stringify(request);
    const first = prepare(request), second = prepare(request);
    assert.deepEqual(first, second);
    assert.notEqual(first, second);
    assert.notEqual(first.draft, second.draft);
    assert.notEqual(first.draft.lineItems[0], input.lineItems[0]);
    first.draft.lineItems[0].description = 'Changed output';
    first.draft.totals.totalMinor = -1;
    assert.equal(second.draft.totals.totalMinor, 1540);
    assert.equal(JSON.stringify(request), snapshot);
});
test('prepared output has no persistence or lifecycle metadata', () => {
    const result = prepare(command());
    assert.deepEqual(Object.keys(result), ['businessId', 'ownerId', 'actorUid', 'draft']);
    assert.deepEqual(Object.keys(result.draft).sort(), Object.keys(validateInvoiceDraft(minimal())).sort());
});
test('module has one pure dependency and no persistence or environment APIs', () => {
    const source = readFileSync(new URL('../js/backend/invoiceDraftCommand.js', import.meta.url), 'utf8');
    assert.deepEqual([...source.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]), ['../finance/invoiceDraftValidator.js']);
    assert.doesNotMatch(source, /\b(?:import|require|fetch|setTimeout|setInterval)\s*\(/);
    assert.doesNotMatch(source, /\b(?:process|globalThis|window|document|localStorage|sessionStorage|Date)\s*[.(]|Math\.random/);
});

