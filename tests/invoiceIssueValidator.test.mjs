import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInvoiceForIssue, InvoiceIssueValidationError } from '../js/finance/invoiceIssueValidator.js';
import { validateInvoiceDraft, InvoiceDraftValidationError } from '../js/finance/invoiceDraftValidator.js';
import { InvoiceCalculationError } from '../js/finance/invoiceCalculations.js';

const line = (extra = {}) => ({ id: 'line-1', description: 'Consulting', quantity: '1.500', unitPriceMinor: 1000, discountMinor: 100, taxRateBps: 1000, taxCode: 'STANDARD', ...extra });
const ready = (extra = {}) => ({ customerName: ' Customer 王 ', currency: 'ZAR', issueDate: '2026-09-07', dueDate: '2026-09-30', lineItems: [line()], ...extra });

test('ready invoice returns precisely the normalized Stage 8B result', () => {
    assert.deepEqual(validateInvoiceForIssue(ready()), validateInvoiceDraft(ready()));
    assert.equal(validateInvoiceForIssue(ready()).totals.totalMinor, 1540);
    assert.equal(validateInvoiceForIssue(ready()).customerName, 'Customer 王');
});
for (const [name, changes, code, path] of [
    ['empty name', {customerName:''}, 'CUSTOMER_NAME_REQUIRED', 'customerName'],
    ['whitespace name', {customerName:'   '}, 'CUSTOMER_NAME_REQUIRED', 'customerName'],
    ['null issue date', {issueDate:null}, 'ISSUE_DATE_REQUIRED', 'issueDate'],
    ['null due date', {dueDate:null}, 'DUE_DATE_REQUIRED', 'dueDate'],
    ['empty lines', {lineItems:[]}, 'LINE_ITEMS_REQUIRED', 'lineItems'],
    ['zero-price invoice', {lineItems:[line({quantity:'1',unitPriceMinor:0,discountMinor:0,taxRateBps:0})]}, 'POSITIVE_TOTAL_REQUIRED', 'totals.totalMinor'],
    ['fully discounted invoice', {lineItems:[line({discountMinor:1500})]}, 'POSITIVE_TOTAL_REQUIRED', 'totals.totalMinor'],
    ['rounded-to-zero invoice', {lineItems:[line({quantity:'0.001',unitPriceMinor:1,discountMinor:0,taxRateBps:0})]}, 'POSITIVE_TOTAL_REQUIRED', 'totals.totalMinor']
]) test(name, () => {
    const input=ready(changes);
    assert.doesNotThrow(()=>validateInvoiceDraft(input));
    assert.throws(()=>validateInvoiceForIssue(input),e=>e instanceof InvoiceIssueValidationError&&e.code===code&&e.path===path&&Boolean(e.message));
});
for(const [field,code] of [['customerName','CUSTOMER_NAME_REQUIRED'],['issueDate','ISSUE_DATE_REQUIRED'],['dueDate','DUE_DATE_REQUIRED']]) test(`omitted ${field}`,()=>{
    const input=ready();delete input[field];assert.doesNotThrow(()=>validateInvoiceDraft(input));
    assert.throws(()=>validateInvoiceForIssue(input),e=>e instanceof InvoiceIssueValidationError&&e.code===code&&e.path===field);
});
test('smallest positive total accepted',()=>assert.equal(validateInvoiceForIssue(ready({lineItems:[line({quantity:'1',unitPriceMinor:1,discountMinor:0,taxRateBps:0})]})).totals.totalMinor,1));
test('multiple lines including a free line accepted when invoice total positive',()=>{
    const result=validateInvoiceForIssue(ready({lineItems:[line(),line({id:'free',unitPriceMinor:0,discountMinor:0})]}));assert.equal(result.lineItems.length,2);assert.equal(result.totals.totalMinor,1540);
});
for(const field of ['customerId','customerEmail']) test(`explicit null ${field} accepted`,()=>assert.equal(validateInvoiceForIssue(ready({[field]:null}))[field],null));
test('omitted customer ID and email normalize to null',()=>{const r=validateInvoiceForIssue(ready());assert.equal(r.customerId,null);assert.equal(r.customerEmail,null);});
test('same-day due date accepted',()=>assert.equal(validateInvoiceForIssue(ready({dueDate:'2026-09-07'})).dueDate,'2026-09-07'));
for(const date of ['0001-01-01','2000-02-29','9999-12-31']) test(`no today policy for ${date}`,()=>assert.equal(validateInvoiceForIssue(ready({issueDate:date,dueDate:date})).issueDate,date));
test('no tax code or rate policy added',()=>assert.doesNotThrow(()=>validateInvoiceForIssue(ready({lineItems:[line({taxCode:'FUTURE_UNRESOLVED_CODE',taxRateBps:20000})]}))));

for(const [name,changes,code,path] of [
    ['currency',{currency:'USD'},'INVALID_CURRENCY','currency'],
    ['calendar date',{issueDate:'2026-02-30'},'INVALID_ISSUE_DATE','issueDate'],
    ['date ordering',{dueDate:'2026-09-01'},'DUE_DATE_BEFORE_ISSUE_DATE','dueDate'],
    ['quantity',{lineItems:[line({quantity:'bad'})]},'INVALID_QUANTITY','lineItems[0]'],
    ['discount',{lineItems:[line({discountMinor:2000})]},'DISCOUNT_EXCEEDS_SUBTOTAL','lineItems[0]'],
    ['overflow',{lineItems:[line({unitPriceMinor:Number.MAX_SAFE_INTEGER})]},'UNSAFE_FINANCIAL_VALUE','lineItems[0]'],
    ['duplicate ID',{lineItems:[line(),line()]},'DUPLICATE_LINE_ID','lineItems[1].id'],
    ['authoritative top field',{ownerId:'owner'},'UNKNOWN_DRAFT_FIELD','draft.ownerId'],
    ['authoritative line field',{lineItems:[line({totalMinor:999})]},'UNKNOWN_LINE_ITEM_FIELD','lineItems[0].totalMinor'],
    ['missing array',{lineItems:undefined},'INVALID_LINE_ITEMS','lineItems'],
    ['invalid snapshot name',{customerName:null},'INVALID_CUSTOMER_NAME','customerName']
]) test(`Stage 8B error propagation: ${name}`,()=>{
    const input=ready(changes);let original;try{validateInvoiceDraft(input);}catch(e){original=e;}
    assert.throws(()=>validateInvoiceForIssue(input),e=>e instanceof InvoiceDraftValidationError&&!(e instanceof InvoiceIssueValidationError)&&e.code===code&&e.path===path&&e.message===original.message);
});
test('arithmetic cause remains available',()=>assert.throws(()=>validateInvoiceForIssue(ready({lineItems:[line({quantity:'0'})]})),e=>e.cause instanceof InvoiceCalculationError&&e.cause.code==='INVALID_QUANTITY'));
test('draft validation runs before issue-only rules',()=>assert.throws(()=>validateInvoiceForIssue({currency:'USD',lineItems:[]}),e=>e instanceof InvoiceDraftValidationError&&e.code==='INVALID_CURRENCY'));
test('nonobject input preserves draft error',()=>assert.throws(()=>validateInvoiceForIssue(null),e=>e instanceof InvoiceDraftValidationError&&e.code==='INVALID_DRAFT'));
test('issue rule order is stable for incomplete draft',()=>assert.throws(()=>validateInvoiceForIssue({currency:'ZAR',lineItems:[]}),e=>e.code==='CUSTOMER_NAME_REQUIRED'));
test('frozen input remains unchanged and repeated results are independent',()=>{
    const input=Object.freeze(ready({lineItems:Object.freeze([Object.freeze(line())])}));const before=JSON.stringify(input);
    const first=validateInvoiceForIssue(input),second=validateInvoiceForIssue(input);assert.deepEqual(first,second);assert.notEqual(first,second);assert.notEqual(first.lineItems[0],second.lineItems[0]);
    first.lineItems[0].description='changed';first.totals.totalMinor=0;assert.equal(second.totals.totalMinor,1540);assert.equal(JSON.stringify(input),before);
});
test('output contains no backend authoritative fields',()=>{
    const result=validateInvoiceForIssue(ready());assert.deepEqual(Object.keys(result),['customerId','customerName','customerEmail','customerAddress','currency','issueDate','dueDate','lineItems','totals']);
    for(const field of ['invoiceNumber','businessId','ownerId','revision','status','paymentStatus','createdAt','issuedAt','sellerSnapshot'])assert.equal(Object.hasOwn(result,field),false);
});
test('calculated preview is not accepted instead of raw draft inputs',()=>assert.throws(()=>validateInvoiceForIssue(validateInvoiceDraft(ready())),e=>e instanceof InvoiceDraftValidationError&&e.code==='UNKNOWN_DRAFT_FIELD'));
