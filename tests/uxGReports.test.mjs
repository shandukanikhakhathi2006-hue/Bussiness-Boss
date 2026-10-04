import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reportsPage = fs.readFileSync(new URL('../reports.html', import.meta.url), 'utf8');
const appScript = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../dashboard.css', import.meta.url), 'utf8');

test('Reports page keeps the final UX-G hierarchy and supported period selector', () => {
	assert.match(reportsPage, /<h1 class="page-title">Reports<\/h1>/);
	assert.match(reportsPage, /<label class="report-period-label" for="reportPeriodSelect">Report period<\/label>/);
	assert.match(reportsPage, /value="This Month"/);
	assert.match(reportsPage, /value="Last Month"/);
	assert.match(reportsPage, /value="This Year"/);
	assert.match(reportsPage, /data-report-metric="revenue"/);
	assert.match(reportsPage, /data-report-metric="expenses"/);
	assert.match(reportsPage, /data-report-metric="net"/);
	assert.match(reportsPage, /id="revenueExpensesChart"/);
	assert.match(reportsPage, /id="expenseCategoryChart"/);
	assert.match(reportsPage, /id="reportSummaryText"/);
	assert.doesNotMatch(reportsPage, /Profit Margin/);
	assert.doesNotMatch(reportsPage, /vs last month/i);
});

test('Legacy report dashboard UI is removed and the report meets the UX-G terminology', () => {
	assert.doesNotMatch(reportsPage, /line-chart/i);
	assert.doesNotMatch(reportsPage, /polyline/i);
	assert.doesNotMatch(reportsPage, /R40K/i);
	assert.doesNotMatch(reportsPage, /trend positive/i);
	assert.doesNotMatch(reportsPage, /Net Profit/i);
	assert.doesNotMatch(reportsPage, /Profit Margin/i);
	assert.match(reportsPage, />Revenue<\/p>/);
	assert.match(reportsPage, />Expenses<\/p>/);
	assert.match(reportsPage, />Net<\/p>/);
	assert.match(appScript, /filter\(isPaidInvoice\)/);
	assert.match(appScript, /calculateProfit\(revenue, expenseTotal\)/);
});

test('Report rendering logic keeps real data, grouped bars, and deterministic summary text', () => {
	assert.match(appScript, /buildGroupedBuckets/);
	assert.match(appScript, /renderGroupedChart/);
	assert.match(appScript, /renderCategoryChart/);
	assert.match(appScript, /No paid invoice revenue was recorded during this period\./);
	assert.match(appScript, /largest expense category/);
	assert.match(appScript, /selectedPeriod/);
	assert.match(styles, /\.report-summary-grid/);
	assert.match(styles, /\.report-bar-chart/);
	assert.match(styles, /\.report-category-bar/);
	assert.match(styles, /\.report-summary-text/);
});
