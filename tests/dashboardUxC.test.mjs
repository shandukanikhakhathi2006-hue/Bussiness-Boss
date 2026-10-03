import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dashboardInvoiceRecords, dashboardInvoicesNeedingFollowUp } from '../js/features/dashboardInvoices.js';

const dashboard = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../dashboard.css', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const recordTable = fs.readFileSync(new URL('../js/utils/recordTable.js', import.meta.url), 'utf8');

test('dashboard invoice focus prioritizes overdue and pending records without changing them', () => {
    const records = [
        { id: 'paid', status: 'paid', issueDate: '2026-10-01' },
        { id: 'later', status: 'pending', dueDate: '2026-10-25' },
        { id: 'old-overdue', status: 'overdue', dueDate: '2026-09-01' },
        { id: 'soon-overdue', status: 'overdue', dueDate: '2026-09-20' }
    ];
    assert.deepEqual(dashboardInvoicesNeedingFollowUp(records).map(record => record.id), [
        'old-overdue', 'soon-overdue', 'later'
    ]);
    assert.deepEqual(dashboardInvoiceRecords(records).map(record => record.id), [
        'old-overdue', 'soon-overdue', 'later'
    ]);
    assert.equal(records[0].status, 'paid');
});

test('dashboard falls back to recent invoices only when nothing needs follow-up', () => {
    const records = [
        { id: 'older', status: 'paid', issueDate: '2026-09-01' },
        { id: 'newer', status: 'paid', issueDate: '2026-10-01' }
    ];
    assert.deepEqual(dashboardInvoiceRecords(records).map(record => record.id), ['newer', 'older']);
    assert.deepEqual(dashboardInvoicesNeedingFollowUp(records), []);
});

test('dashboard markup presents attention, schedule, follow-up, and compact snapshot in order', () => {
    const attention = dashboard.indexOf('id="dashboardAttention"');
    const metrics = dashboard.indexOf('class="stats-grid dashboard-metrics"');
    const schedule = dashboard.indexOf('id="todaySchedule"');
    const invoices = dashboard.indexOf('id="dashboardInvoices"');
    const snapshot = dashboard.indexOf('id="financialSnapshot"');
    assert.ok(attention >= 0 && attention < metrics);
    assert.ok(metrics < schedule && schedule < invoices && invoices < snapshot);
    assert.match(dashboard, /class="[^"]*action-card[^"]*"[^>]*id="dashboardPrimaryAction"/);
    assert.doesNotMatch(dashboard, /New Transaction|Revenue by Service|id="revenueChartLine"/);
    assert.doesNotMatch(dashboard, /vs last month|vs yesterday/);
});

test('dashboard uses a single-column priority flow and KPI layout on phones', () => {
    assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.attention-grid,[\s\S]*?\.dashboard \.dashboard-metrics,[\s\S]*?\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    assert.match(styles, /\.dashboard-snapshot \.performance-summary/);
});

test('dashboard renders active appointments and real follow-up invoice states', () => {
    assert.match(script, /dashboardUpcomingAppointments\(bookingData, today\)\.filter/);
    assert.match(script, /dashboardInvoicesNeedingFollowUp\(invoiceData\)/);
    assert.match(script, /data-attention-value="appointments"/);
    assert.match(script, /data-attention-value="overdue-invoices"/);
    assert.match(script, /data-metric-value="outstanding"/);
    assert.match(script, /status-badge \$\{getBookingStatusClass\(status\)\}/);
    assert.match(script, /status-badge \$\{getInvoiceStatusClass\(status\)\}/);
    assert.doesNotMatch(script, /newTransactionButton|renderRevenueChartForPeriod/);
    assert.match(recordTable, /const loadingClass = state === 'loading' \? ' loading-cell'/);
});
