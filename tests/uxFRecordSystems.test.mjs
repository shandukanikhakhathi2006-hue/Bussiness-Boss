import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const expensesPage = fs.readFileSync(new URL('../expenses.html', import.meta.url), 'utf8');
const paymentsPage = fs.readFileSync(new URL('../payments.html', import.meta.url), 'utf8');
const appScript = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../dashboard.css', import.meta.url), 'utf8');

test('Expenses page keeps a compact summary, supported status metrics, and mobile cards', () => {
	assert.match(expensesPage, /<h1 class="page-title">Expenses<\/h1>/);
	assert.match(expensesPage, /class="stats-grid expenses-summary"/);
	assert.match(expensesPage, /<p>Total Spend<\/p>/);
	assert.match(expensesPage, /<p>Approved<\/p>/);
	assert.match(expensesPage, /<p>Pending<\/p>/);
	assert.doesNotMatch(expensesPage, /Over Budget/);
	assert.match(expensesPage, /id="expenseCategoryFilter"/);
	assert.match(expensesPage, /class="record-card-list expense-record-cards"/);
	assert.match(styles, /\.workspace-refined \.expenses-summary/);
	assert.match(styles, /\.record-card-list \{/);
});

test('Payments page removes unsupported refund KPI language and keeps payment record workflow tools', () => {
	assert.match(paymentsPage, /<h1 class="page-title">Payments<\/h1>/);
	assert.match(paymentsPage, /class="stats-grid payments-summary"/);
	assert.match(paymentsPage, /<p>Total Payments<\/p>/);
	assert.match(paymentsPage, /<p>Received<\/p>/);
	assert.match(paymentsPage, /<p>Pending<\/p>/);
	assert.doesNotMatch(paymentsPage, /Refunds/);
	assert.match(paymentsPage, /id="paymentMethodFilter"/);
	assert.match(paymentsPage, /class="record-card-list payment-record-cards"/);
	assert.match(styles, /\.workspace-refined \.payments-summary/);
	assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.table-container \{\s*display:\s*none;/);
});

test('Shared record filtering and clear-button behavior supports expense and payment UX-F requirements', () => {
	assert.match(appScript, /if \(select\.id === 'expenseCategoryFilter'\)/);
	assert.match(appScript, /if \(select\.id === 'paymentMethodFilter'\)/);
	assert.match(appScript, /if \(clearFiltersButton\) clearFiltersButton\.hidden = !hasActiveFilters;/);
	assert.match(appScript, /renderMobileCardList\(pageShell\.querySelector\('\.record-card-list'\), records\);/);
});
