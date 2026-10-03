import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../appointments.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../dashboard.css', import.meta.url), 'utf8');
const feature = fs.readFileSync(new URL('../js/features/appointments.js', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const contract = fs.readFileSync(new URL('../js/features/appointmentContract.js', import.meta.url), 'utf8');

test('Appointments page uses one clear heading, a focused primary action, and grouped schedule controls', () => {
	assert.equal((page.match(/<h1\b/g) || []).length, 1);
	assert.match(page, /<h1 class="page-title">Appointments<\/h1>/);
	assert.match(page, /Manage bookings and see what is coming up/);
	assert.match(page, /<button class="primary-button" type="button">[\s\S]*?New Appointment/);
	assert.match(page, /class="appointments-toolbar" role="group" aria-label="Schedule controls"/);
	assert.match(page, /id="appointmentPeriodFilter"/);
	assert.match(page, /id="appointmentsCalendarViewButton"[^>]*aria-pressed="false"/);
	assert.doesNotMatch(page.match(/<div class="page-actions">([\s\S]*?)<\/div>/)?.[1] || '', /appointmentPeriodFilter|Calendar view/);
});

test('appointment table and calendar expose date, customer, status, actions, and selected-day states', () => {
	for (const heading of ['Date &amp; time', 'Customer', 'Service', 'Staff', 'Status', 'Actions']) {
		assert.ok(page.includes(`<th scope="col">${heading}</th>`), `missing table heading: ${heading}`);
	}
	assert.match(page, /aria-label="Appointments by day"/);
	assert.match(page, /aria-label="Calendar month navigation"/);
	assert.match(page, /aria-live="polite"/);
	assert.match(feature, /aria-pressed="\$\{selected\}"/);
	assert.match(feature, /aria-current="date"/);
	assert.match(feature, /No appointments scheduled for this day/);
	assert.match(feature, /data-page-action="complete"/);
	assert.match(feature, /data-page-action="cancel"/);
	assert.match(feature, /data-page-action="edit"/);
	assert.match(feature, /data-page-action="delete"/);
});

test('appointment form keeps canonical fields and customer IDs with a compact responsive modal', () => {
	for (const field of ['customerId', 'date', 'time', 'service', 'staff', 'status']) {
		assert.ok(contract.includes(`'${field}'`), `missing canonical field: ${field}`);
	}
	assert.match(feature, /appointmentCustomerOptions\(customers, existing\.customerId, existing\.customerName\)/);
	assert.match(script, /prepareAppointmentCustomer\(\{ customers, values, existing, isEditing \}\)/);
	assert.match(script, /className: recordFeature === appointmentsFeature \? 'appointment-form-dialog' : ''/);
	assert.match(styles, /\.appointment-form-dialog \.app-modal-fields\s*\{\s*display:\s*grid;/);
	assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.appointment-form-dialog \.app-modal-fields\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
	assert.match(styles, /@media \(max-width: 960px\) \{\s*\.workspace-refined \.appointments-metrics \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
	assert.match(styles, /\.appointments-page \.table-container tbody td\.appointment-actions\s*\{[^}]*white-space:\s*normal;/);
	assert.match(styles, /\.appointments-metrics \.stat-card\s*\{[^}]*flex-direction:\s*column;/);
});

test('appointment status semantics, owner scope, and loading/error retry remain explicit', () => {
	assert.match(feature, /collection\(firestore, 'bookings'\), where\('ownerId', '==', user\.uid\)/);
	assert.match(feature, /if \(isCompletedAppointment\(record\)\) return false/);
	assert.match(feature, /filter\(isCancelledAppointment\)/);
	assert.match(feature, /requirePendingOwnedRecord/);
	assert.match(feature, /state === 'error' \? 'alert' : 'status'/);
	assert.match(feature, /appointmentsLoadState === 'loading' \? 'Loading appointments/);
	assert.match(feature, /setCalendarError = \(message\)/);
	assert.match(feature, /data-appointments-retry/);
	assert.match(script, /appointmentsFeature\.setError\('Appointments could not be loaded/);
	assert.match(styles, /@media \(max-width: 360px\)[\s\S]*?appointments-calendar button\.calendar-day/);
});
