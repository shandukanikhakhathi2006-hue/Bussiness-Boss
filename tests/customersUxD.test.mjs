import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../customers.html', import.meta.url), 'utf8');
const feature = fs.readFileSync(new URL('../js/features/customers.js', import.meta.url), 'utf8');
const controller = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../dashboard.css', import.meta.url), 'utf8');

test('customer page presents a focused directory and truthful summary metrics', () => {
	assert.match(page, /<h1 class="page-title">Customers<\/h1>/);
	assert.match(page, /Add Customer/);
	assert.match(page, /Export customers as CSV/);
	assert.match(page, /Total customers/);
	assert.match(page, /Active customers/);
	assert.match(page, /Inactive customers/);
	assert.doesNotMatch(page, /VIP|vs last month|up this quarter|trend positive/);
	assert.equal((page.match(/<h1\b/g) || []).length, 1);
	assert.equal((page.match(/data-clear-filters/g) || []).length, 1);
});

test('customer directory groups contact details and keeps actions native and named', () => {
	assert.match(page, /<th scope="col">Customer<\/th>/);
	assert.match(page, /<th scope="col">Contact<\/th>/);
	assert.match(page, /<th scope="col">Total spent<\/th>/);
	assert.match(page, /<th scope="col">Status<\/th>/);
	assert.match(page, /<th scope="col">Actions<\/th>/);
	assert.match(feature, /data-record-id="\$\{pageEscape\(record\.id\)\}"/);
	assert.match(feature, /class="customer-contact"/);
	assert.match(feature, /data-page-action="edit" aria-label="Edit \$\{pageEscape\(name\)\}"/);
	assert.match(feature, /data-page-action="delete" aria-label="Delete \$\{pageEscape\(name\)\}"/);
	assert.match(feature, /\[record\.email, record\.phone\]\.filter\(Boolean\)/);
	assert.match(feature, /<span>\$\{pageEscape\(value\)\}<\/span>/);
});

test('customer reads, updates, and deletes preserve the existing owner and document-ID boundaries', () => {
	assert.match(feature, /where\(\'ownerId\', \'==\', user\.uid\)/);
	assert.match(feature, /doc\(firestore, \'customers\', recordId\)/);
	assert.match(feature, /deleteDoc\(doc\(firestore, \'customers\', recordId\)\)/);
	assert.match(controller, /pageRecords\.find\(\(record\) => record\.id === recordId\)/);
	assert.match(controller, /customerName \? `Delete \$\{customerName\}\?`/);
	assert.match(controller, /if \(pageName === 'customers'\) pageShell\.querySelector\('\.page-actions \.primary-button'\)\?\.focus\(\)/);
});

test('customer status and search filtering have one progressively disclosed clear action', () => {
	assert.match(page, /type="search"[^>]*aria-label="Search customers by name or contact"/);
	assert.match(page, /id="customerStatusFilter"[^>]*aria-label="Filter by customer status"/);
	assert.match(page, /data-clear-filters hidden/);
	assert.match(feature, /String\(record\.status \|\| ''\)\.toLowerCase\(\) === select\.value/);
	assert.match(controller, /if \(pageName === 'customers'\) \{\s*return \[record\.name, record\.email, record\.phone\]/);
	assert.match(controller, /recordMatchesFilters\(record\) && recordMatchesSearch\(record, searchValue\)/);
	assert.match(controller, /const hasActiveFilters = Boolean\(pageSearch\?\.value\.trim\(\)\) \|\| pageFilterSelects\.some/);
	assert.match(controller, /clearFiltersButton\.hidden = !hasActiveFilters/);
	assert.match(controller, /\.\.\.\(pageName === 'customers' \? \{\} : \{ actionLabel: 'Clear filters' \}\)/);
	assert.match(controller, /pageFilterSelects\.forEach\(\(select\) => \{ select\.value = 'all'; \}\)/);
});

test('customer cards remain responsive and preserve readable contact and action content', () => {
	assert.match(styles, /\.customer-metrics\s*\{\s*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
	assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.customer-metrics/);
	assert.match(styles, /@media \(max-width: 390px\)[\s\S]*?\.customer-metrics/);
	assert.match(styles, /\.customer-directory \.customer-name,[\s\S]*?overflow-wrap:\s*anywhere/);
	assert.match(styles, /\.customer-directory \.customer-contact\s*\{\s*display:\s*grid;/);
});
