import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInvoiceDraft, InvoiceDraftValidationError } from '../js/finance/invoiceDraftValidator.js';
import { calculateInvoiceTotals, InvoiceCalculationError } from '../js/finance/invoiceCalculations.js';

const line = (extra = {}) => ({ id: 'line-1', description: 'Consulting', quantity: '1.500', unitPriceMinor: 1000, discountMinor: 100, taxRateBps: 1000, taxCode: 'STANDARD', ...extra });
const draft = (extra = {}) => ({ currency: 'ZAR', lineItems: [], ...extra });
const checkError = (input, code, path) => assert.throws(() => validateInvoiceDraft(input), error => error instanceof InvoiceDraftValidationError && error.code === code && (!path || error.path === path));

test('minimal draft returns explicit defaults and zero totals', () => assert.deepEqual(validateInvoiceDraft(draft()), { customerId: null, customerName: '', customerEmail: null, customerAddress: null, currency: 'ZAR', issueDate: null, dueDate: null, lineItems: [], totals: { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 } }));
test('populated draft normalizes text and preserves Unicode and quantity spelling', () => {
    const result = validateInvoiceDraft(draft({ customerId: ' abc ', customerName: ' Élodie 王 ', customerEmail: ' User+tag@example.com ', customerAddress: ' 12 Road\r\nCape Town ', issueDate: '2026-09-07', dueDate: '2026-09-30', lineItems: [line({ id: ' first ', description: ' 咨询 & <advice> ', taxCode: ' STANDARD ', catalogItemId: ' item ' }), line({ id: 'second', quantity: '0.500', unitPriceMinor: 1, discountMinor: 0, taxRateBps: 0 })] }));
    assert.equal(result.customerName, 'Élodie 王'); assert.equal(result.customerAddress, '12 Road\nCape Town'); assert.equal(result.customerEmail, 'User+tag@example.com');
    assert.equal(result.lineItems[0].description, '咨询 & <advice>'); assert.equal(result.lineItems[0].catalogItemId, 'item'); assert.equal(result.lineItems[0].quantity, '1.500');
    assert.deepEqual(result.totals, { subtotalMinor: 1501, discountMinor: 100, taxMinor: 140, totalMinor: 1541 });
});
test('quantity and rounding stay delegated to Stage 8A', () => {
    const lines = [line(), line({ id: 'two', quantity: '0.5', unitPriceMinor: 1, discountMinor: 0, taxRateBps: 5000 })];
    assert.deepEqual(validateInvoiceDraft(draft({ lineItems: lines })).totals, calculateInvoiceTotals(lines));
});
for (const input of [null, undefined, [], new Date(), 'draft', 1, Object.create({ currency: 'ZAR' })]) test(`reject non-plain draft ${String(input)}`, () => checkError(input, 'INVALID_DRAFT'));
for (const field of ['schemaVersion','businessId','ownerId','invoiceNumber','revision','subtotalMinor','discountMinor','taxMinor','totalMinor','amountPaidMinor','balanceDueMinor','status','paymentStatus','createdAt','updatedAt','createdBy','issuedAt','sentAt','paidAt','cancelledAt','lastFinancialEventId','migration','sellerSnapshot','provider','verifiedAt','totals','__proto__']) {
    test(`reject authoritative/unknown draft field ${field}`, () => checkError({ ...draft(), [field]: 1 }, 'UNKNOWN_DRAFT_FIELD'));
}
for (const field of ['subtotalMinor','taxMinor','totalMinor','verified','backendCalculatedTotal','ownerId','status','paymentStatus','provider','verifiedAt']) test(`reject unknown line field ${field}`, () => checkError(draft({ lineItems: [line({ [field]: 1 })] }), 'UNKNOWN_LINE_ITEM_FIELD', `lineItems[0].${field}`));
test('unknown symbol field is rejected', () => checkError({ ...draft(), [Symbol('extra')]: 1 }, 'UNKNOWN_DRAFT_FIELD'));
test('unknown nonenumerable field is rejected', () => checkError(Object.defineProperty(draft(), 'ownerId', { value: 'owner' }), 'UNKNOWN_DRAFT_FIELD'));
test('accessor property is rejected without executing', () => checkError(Object.defineProperty(draft(), 'customerName', { get() { throw Error('must not run'); } }), 'INVALID_DRAFT'));
test('plain null-prototype objects are accepted', () => assert.equal(validateInvoiceDraft(Object.assign(Object.create(null), draft())).currency, 'ZAR'));

for (const [field, code, limit] of [['customerId','INVALID_CUSTOMER_ID',128],['customerName','INVALID_CUSTOMER_NAME',200],['customerEmail','INVALID_CUSTOMER_EMAIL',254],['customerAddress','INVALID_CUSTOMER_ADDRESS',1000]]) {
    for (const value of [42, undefined, 'a\u0000b', 'a\u007fb', 'a'.repeat(limit + 1)]) test(`${field} invalid ${String(value).slice(0,20)}`, () => checkError(draft({ [field]: value }), code, field));
}
for (const field of ['customerId','customerEmail','customerAddress']) {
    test(`${field} accepts null`, () => assert.equal(validateInvoiceDraft(draft({ [field]: null }))[field], null));
    test(`${field} rejects blank`, () => checkError(draft({ [field]: '   ' }), `INVALID_${field.replace(/([A-Z])/g, '_$1').toUpperCase()}`));
}
test('empty customer name is allowed', () => assert.equal(validateInvoiceDraft(draft({ customerName: '  ' })).customerName, ''));
test('null customer name is rejected', () => checkError(draft({ customerName: null }), 'INVALID_CUSTOMER_NAME'));
for (const email of ['name@example.com','first.last+tag@example.co.za']) test(`valid email ${email}`, () => assert.equal(validateInvoiceDraft(draft({ customerEmail: email })).customerEmail, email));
for (const email of ['abc','@example.com','name@','a@@example.com','a b@example.com','a..b@example.com','a@-example.com','a@example..com','a@example','a@exam_ple.com']) test(`invalid email ${email}`, () => checkError(draft({ customerEmail: email }), 'INVALID_CUSTOMER_EMAIL'));
test('string boundaries count Unicode code points', () => {
    const r = validateInvoiceDraft(draft({ customerId:'x'.repeat(128),customerName:'😀'.repeat(200),customerAddress:'x'.repeat(1000),lineItems:[line({description:'字'.repeat(500),id:'x'.repeat(128),taxCode:'x'.repeat(64),catalogItemId:'y'.repeat(128)})] }));
    assert.equal(Array.from(r.customerName).length,200);
});
test('multiline address permits CR/LF but not tabs', () => {
    assert.equal(validateInvoiceDraft(draft({ customerAddress:'a\rb\nc' })).customerAddress,'a\nb\nc');
    checkError(draft({ customerAddress:'a\tb' }), 'INVALID_CUSTOMER_ADDRESS');
});
for (const currency of ['zar','USD','EUR',' ZAR','ZAR ',null,undefined,1]) test(`invalid currency ${currency}`, () => checkError(draft({ currency }), 'INVALID_CURRENCY', 'currency'));

for (const field of ['issueDate','dueDate']) {
    const code = field === 'issueDate' ? 'INVALID_ISSUE_DATE' : 'INVALID_DUE_DATE';
    for (const date of ['2026-09-07','2028-02-29','2000-02-29','0001-01-01','9999-12-31',null]) test(`${field} valid ${date}`, () => assert.equal(validateInvoiceDraft(draft({[field]:date}))[field],date));
    for (const date of ['2026-02-29','2026-02-30','1900-02-29','2026-13-01','2026-00-10','2026-01-00','2026-04-31','09/07/2026','0000-01-01','2026-9-07','2026-09-07\n','2026-09-07T00:00:00Z',undefined,42]) test(`${field} invalid ${String(date)}`, () => checkError(draft({[field]:date}),code,field));
}
test('due date order crosses years safely', () => checkError(draft({issueDate:'2027-01-01',dueDate:'2026-12-31'}),'DUE_DATE_BEFORE_ISSUE_DATE','dueDate'));
test('equal dates allowed', () => assert.equal(validateInvoiceDraft(draft({issueDate:'2026-09-07',dueDate:'2026-09-07'})).dueDate,'2026-09-07'));
test('100 lines accepted', () => assert.equal(validateInvoiceDraft(draft({lineItems:Array.from({length:100},(_,i)=>line({id:String(i)}))})).lineItems.length,100));
test('101 lines rejected', () => checkError(draft({lineItems:Array.from({length:101},(_,i)=>line({id:String(i)}))}),'TOO_MANY_LINE_ITEMS'));
for (const value of [null,{},undefined,'lines']) test(`invalid lineItems ${value}`,()=>checkError(draft({lineItems:value}),'INVALID_LINE_ITEMS'));
test('sparse array rejected',()=>checkError(draft({lineItems:new Array(1)}),'INVALID_LINE_ITEMS','lineItems[0]'));
test('array accessors rejected without running',()=>checkError(draft({lineItems:Object.defineProperty([],0,{get(){throw Error('must not run');}})}),'INVALID_LINE_ITEMS'));
for (const value of [null,[],new Date(),'line',undefined,Object.create({id:'inherited'})]) test(`non-plain line ${String(value)}`,()=>checkError(draft({lineItems:[value]}),'INVALID_LINE_ITEM'));
test('duplicate normalized IDs rejected',()=>checkError(draft({lineItems:[line(),line({id:' line-1 '})]}),'DUPLICATE_LINE_ID','lineItems[1].id'));
for (const [field,code,limit] of [['id','INVALID_LINE_ID',128],['description','INVALID_DESCRIPTION',500],['taxCode','INVALID_TAX_CODE',64],['catalogItemId','INVALID_CATALOG_ITEM_ID',128]]) {
    for (const value of ['', ' ',1,'bad\ntext','x'.repeat(limit+1)]) test(`${field} invalid line text ${String(value).slice(0,20)}`,()=>checkError(draft({lineItems:[line({[field]:value})]}),code,`lineItems[0].${field}`));
}
test('catalog null and omitted normalize to null',()=>{for(const input of [line(),line({catalogItemId:null})])assert.equal(validateInvoiceDraft(draft({lineItems:[input]})).lineItems[0].catalogItemId,null);});
for(const [extra,code] of [[{quantity:'1.2345'},'INVALID_QUANTITY'],[{quantity:' 1'},'INVALID_QUANTITY'],[{unitPriceMinor:'1000'},'INVALID_UNIT_PRICE'],[{discountMinor:-1},'INVALID_DISCOUNT'],[{discountMinor:2000},'DISCOUNT_EXCEEDS_SUBTOTAL'],[{taxRateBps:0.1},'INVALID_TAX_RATE'],[{unitPriceMinor:Number.MAX_SAFE_INTEGER},'UNSAFE_FINANCIAL_VALUE']]) {
    test(`Stage 8A error context ${code} ${JSON.stringify(extra)}`,()=>assert.throws(()=>validateInvoiceDraft(draft({lineItems:[line(),line({id:'two',...extra})]})),e=>e instanceof InvoiceDraftValidationError&&e.code===code&&e.path==='lineItems[1]'&&e.cause instanceof InvoiceCalculationError));
}
test('frozen nested input is not mutated and output is independent',()=>{
    const item=Object.freeze(line());const items=Object.freeze([item]);const input=Object.freeze(draft({lineItems:items}));const before=JSON.stringify(input);
    const a=validateInvoiceDraft(input),b=validateInvoiceDraft(input);assert.deepEqual(a,b);a.lineItems[0].description='changed';a.totals.totalMinor=0;assert.equal(JSON.stringify(input),before);assert.equal(b.totals.totalMinor,1540);
});
test('returned preview is not silently accepted as command input',()=>checkError(validateInvoiceDraft(draft()),'UNKNOWN_DRAFT_FIELD'));
