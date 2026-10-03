import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173';
const pages = [
	'dashboard.html',
	'appointments.html',
	'customers.html',
	'expenses.html',
	'invoices.html',
	'payments.html',
	'messages.html',
	'reports.html',
	'settings.html',
	'help.html'
];
const viewports = [
	{ name: 'desktop', width: 1440, height: 900 },
	{ name: 'laptop', width: 1024, height: 768 },
	{ name: 'tablet', width: 768, height: 1024 },
	{ name: 'phone', width: 390, height: 844 },
	{ name: 'narrow-phone', width: 320, height: 720 }
];
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
	for (const viewport of viewports) {
		const context = await browser.newContext({ viewport });
		const page = await context.newPage();
		const consoleErrors = [];
		page.on('console', (message) => {
			if (message.type() === 'error') consoleErrors.push(message.text());
		});
		page.on('pageerror', (error) => consoleErrors.push(error.message));

		await page.goto(`${baseUrl}/login.html?emulator=1`, { waitUntil: 'domcontentloaded' });
		await page.getByLabel('Email address').fill('stage9nb-browser@example.test');
		await page.getByLabel('Password').fill('local-browser-test');
		await page.getByRole('button', { name: /log in/i }).click();
		await page.waitForFunction(() => document.querySelector('#profileDropdownEmail')?.textContent.trim() === 'stage9nb-browser@example.test');

		if (viewport.width <= 390) {
			const menuButton = page.locator('#menuButton');
			await menuButton.click();
			if (await menuButton.getAttribute('aria-label') !== 'Close navigation') {
				throw new Error(`${viewport.name}: opening the navigation did not update its accessible name.`);
			}
			await page.keyboard.press('Escape');
			if (await menuButton.getAttribute('aria-label') !== 'Open navigation') {
				throw new Error(`${viewport.name}: Escape did not close the navigation.`);
			}
			await menuButton.click();
			await page.locator('.sidebar-backdrop').click({
				position: { x: viewport.width - 10, y: Math.floor(viewport.height / 2) }
			});
			if (await menuButton.getAttribute('aria-label') !== 'Open navigation') {
				throw new Error(`${viewport.name}: the navigation backdrop did not close the drawer.`);
			}
		}

		for (const file of pages) {
			const response = await page.goto(`${baseUrl}/${file}?emulator=1`, { waitUntil: 'commit' });
			if (!response?.ok()) throw new Error(`${viewport.name} ${file}: page response was ${response?.status()}.`);
			await page.waitForFunction(() => document.querySelector('#profileDropdownEmail')?.textContent.trim() === 'stage9nb-browser@example.test');
			const heading = page.locator('main h1').first();
			await heading.waitFor({ state: 'visible' });
			const result = await page.evaluate(() => ({
				overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
				overflowingElements: [...document.querySelectorAll('body *')]
					.filter((element) => element.getClientRects().length)
					.map((element) => {
						const bounds = element.getBoundingClientRect();
						return {
							tag: element.tagName.toLowerCase(),
							className: typeof element.className === 'string' ? element.className : '',
							id: element.id,
							left: Math.round(bounds.left),
							right: Math.round(bounds.right),
							width: Math.round(bounds.width),
							scrollWidth: element.scrollWidth,
							clientWidth: element.clientWidth
						};
					})
					.filter((element) => element.right > window.innerWidth + 1)
					.sort((first, second) => second.right - first.right)
					.slice(0, 8),
				headingText: document.querySelector('main h1')?.textContent.trim(),
				visiblePageActions: [...document.querySelectorAll('.page-actions button, form button[type="submit"]')]
					.filter((button) => !button.disabled && button.getClientRects().length > 0).length,
				tableOverflows: [...document.querySelectorAll('.table-container')]
					.filter((table) => table.scrollWidth > table.clientWidth + 1)
					.map((table) => ({
						clientWidth: table.clientWidth,
						scrollWidth: table.scrollWidth,
						tableWidth: table.querySelector('table')?.getBoundingClientRect().width,
						bodyWidth: table.querySelector('tbody')?.getBoundingClientRect().width,
						rowWidths: [...table.querySelectorAll('tbody tr')].map((row) => row.getBoundingClientRect().width)
					}))
			}));
			if (!result.headingText) throw new Error(`${viewport.name} ${file}: the page h1 is empty.`);
			if (result.overflow) throw new Error(`${viewport.name} ${file}: page-wide horizontal overflow detected: ${JSON.stringify(result.overflowingElements)}`);
			if (viewport.width <= 390 && result.tableOverflows.length) {
				throw new Error(`${viewport.name} ${file}: a record table overflows its mobile card container: ${JSON.stringify(result.tableOverflows)}`);
			}
			if (file !== 'dashboard.html' && !result.visiblePageActions
				&& ['appointments.html', 'customers.html', 'expenses.html', 'invoices.html', 'payments.html'].includes(file)) {
				throw new Error(`${viewport.name} ${file}: primary record actions are not visible.`);
			}

			if (file === 'dashboard.html') {
				await page.waitForFunction(() =>
					document.querySelector('#appointmentTableBody')?.getAttribute('aria-busy') === 'false'
					&& document.querySelector('#invoiceTableBody')?.getAttribute('aria-busy') === 'false');
				const dashboardState = await page.evaluate(() => ({
					headingCount: document.querySelectorAll('main h1').length,
					attentionVisible: document.querySelector('#dashboardAttention')?.getClientRects().length > 0,
					metrics: document.querySelectorAll('.dashboard-metrics [data-metric-value]').length,
					hasFullChart: Boolean(document.querySelector('#revenueChartLine')),
					appointmentRows: document.querySelectorAll('#appointmentTableBody tr').length,
					invoiceRows: document.querySelectorAll('#invoiceTableBody tr').length
				}));
				if (dashboardState.headingCount !== 1 || !dashboardState.attentionVisible || dashboardState.metrics !== 3) {
					throw new Error(`${viewport.name} dashboard: expected one visible heading, attention area, and three compact metrics: ${JSON.stringify(dashboardState)}`);
				}
				if (dashboardState.hasFullChart) throw new Error(`${viewport.name} dashboard: the Reports-style full chart should not appear on the dashboard.`);
				if (!dashboardState.appointmentRows || !dashboardState.invoiceRows) {
					throw new Error(`${viewport.name} dashboard: schedule or invoice state did not render.`);
				}

				if (viewport.width === 1440) {
					const testCustomer = 'UX-C Browser Customer';
					await page.getByRole('button', { name: 'Add Customer' }).click();
					const newCustomer = page.getByRole('dialog');
					await newCustomer.waitFor({ state: 'visible' });
					await newCustomer.getByLabel('Customer name').fill(testCustomer);
					await newCustomer.getByLabel('Customer email').fill('ux-c-browser@example.test');
					await newCustomer.getByRole('button', { name: 'Save' }).click();
					await newCustomer.waitFor({ state: 'detached' });

					await page.getByRole('button', { name: 'New Appointment' }).click();
					const newAppointment = page.getByRole('dialog');
					await newAppointment.waitFor({ state: 'visible' });
					const today = await page.evaluate(() => {
						const date = new Date();
						return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
					});
					await newAppointment.getByLabel('Customer').selectOption({ label: testCustomer });
					await newAppointment.getByLabel('Appointment date').fill(today);
					await newAppointment.getByLabel('Appointment time').fill('09:30');
					await newAppointment.getByRole('button', { name: 'Save' }).click();
					await newAppointment.waitFor({ state: 'detached' });
					await page.waitForFunction((customerName) =>
						document.querySelector('#appointmentTableBody')?.textContent.includes(customerName)
						&& document.querySelector('#appointmentTableBody')?.textContent.includes('pending')
						&& Number(document.querySelector('[data-attention-value="appointments"]')?.textContent) >= 1, testCustomer);

					await page.getByRole('button', { name: 'Create Invoice' }).click();
					const newInvoice = page.getByRole('dialog');
					await newInvoice.waitFor({ state: 'visible' });
					await newInvoice.getByLabel('Customer name').fill(testCustomer);
					await newInvoice.getByLabel('Invoice amount').fill('1250');
					await newInvoice.getByLabel('Status').selectOption('pending');
					await newInvoice.getByRole('button', { name: 'Save' }).click();
					await newInvoice.waitFor({ state: 'detached' });
					await page.waitForFunction((customerName) =>
						document.querySelector('#invoiceTableBody')?.textContent.includes(customerName)
						&& (document.querySelector('[data-metric-value="outstanding"]')?.textContent.match(/\d/g) || []).join('').includes('1250'), testCustomer);
				}

				const primaryAction = page.getByRole('button', { name: 'New Appointment' });
				await primaryAction.click();
				const appointmentDialog = page.getByRole('dialog');
				await appointmentDialog.waitFor({ state: 'visible' });
				await page.keyboard.press('Escape');
				await appointmentDialog.waitFor({ state: 'detached' });
				await page.locator('#viewCalendarButton').click();
				const calendarDialog = page.getByRole('dialog', { name: 'Business Calendar' });
				await calendarDialog.waitFor({ state: 'visible' });
				await page.getByRole('button', { name: 'Close calendar' }).click();
				await calendarDialog.waitFor({ state: 'hidden' });
			}

			if (file === 'customers.html') {
				await page.waitForFunction(() =>
					document.querySelector('.customer-directory tbody')?.getAttribute('aria-busy') === 'false');
				const customerLayout = await page.evaluate(() => ({
					metrics: [...document.querySelectorAll('.customer-metrics .stat-card > p')].map((card) => card.textContent.trim()),
					columnCount: document.querySelectorAll('.customer-directory thead th').length,
					clearButtons: document.querySelectorAll('.customer-directory [data-clear-filters]').length,
					clearInitiallyHidden: document.querySelector('.customer-directory [data-clear-filters]')?.hidden
				}));
				if (customerLayout.metrics.join('|') !== 'Total customers|Active customers|Inactive customers'
					|| customerLayout.columnCount !== 5 || customerLayout.clearButtons !== 1 || !customerLayout.clearInitiallyHidden) {
					throw new Error(`${viewport.name} customers.html: customer directory controls or summaries are inconsistent: ${JSON.stringify(customerLayout)}`);
				}

				if (viewport.width === 1440) {
					const customerName = 'UX-D Browser Customer';
					const createCustomer = async (email, status) => {
						await page.getByRole('button', { name: 'Add Customer' }).click();
						const customerDialog = page.getByRole('dialog');
						await customerDialog.waitFor({ state: 'visible' });
						await customerDialog.getByLabel('Customer name').fill(customerName);
						await customerDialog.getByLabel('Customer email').fill(email);
						await customerDialog.getByLabel('Customer phone').fill('010 555 0134');
						await customerDialog.getByLabel('Status').selectOption(status);
						await customerDialog.getByRole('button', { name: 'Add' }).click();
						await customerDialog.waitFor({ state: 'detached' });
					};
					await createCustomer('ux-d-one@example.test', 'active');
					await createCustomer('ux-d-two@example.test', 'inactive');

					const duplicateRows = page.locator('.customer-directory tbody tr[data-record-id]').filter({ hasText: customerName });
					await page.waitForFunction((name) =>
						[...document.querySelectorAll('.customer-directory tbody tr[data-record-id]')]
							.filter((row) => row.textContent.includes(name)).length === 2, customerName);
					const customerIds = await duplicateRows.evaluateAll((rows) => rows.map((row) => row.dataset.recordId));
					if (!customerIds[0] || !customerIds[1] || customerIds[0] === customerIds[1]) {
						throw new Error('customers.html: same-name customers did not retain distinct document IDs.');
					}
					const activeCustomerId = await page.locator('.customer-directory tbody tr[data-record-id]')
						.filter({ hasText: 'ux-d-one@example.test' }).getAttribute('data-record-id');

					const search = page.getByRole('searchbox', { name: 'Search customers by name or contact' });
					await search.fill('ux-d-two@example.test');
					if (await page.locator('.customer-directory tbody tr[data-record-id]').count() !== 1
						|| !(await page.locator('.customer-directory tbody').textContent()).includes('ux-d-two@example.test')) {
						throw new Error('customers.html: contact search did not isolate the matching customer.');
					}
					const clearFilters = page.getByRole('button', { name: 'Clear filters' });
					if (!(await clearFilters.isVisible())) throw new Error('customers.html: clear filters did not appear for an active search.');
					await clearFilters.click();
					if (!(await page.locator('.customer-directory [data-clear-filters]').isHidden())
						|| (await duplicateRows.count()) !== 2) {
						throw new Error('customers.html: clearing the search did not restore the full directory.');
					}

					await page.getByLabel('Filter by customer status').selectOption('inactive');
					if (await page.locator('.customer-directory tbody tr[data-record-id]').count() !== 1
						|| !(await page.locator('.customer-directory tbody').textContent()).includes('ux-d-two@example.test')) {
						throw new Error('customers.html: status filtering did not isolate inactive customers.');
					}
					await page.getByRole('button', { name: 'Clear filters' }).click();
					await page.getByLabel('Filter by customer status').selectOption('all');

					const activeRow = page.locator('.customer-directory tbody tr[data-record-id]').filter({ hasText: 'ux-d-one@example.test' });
					await activeRow.getByRole('button', { name: `Edit ${customerName}` }).click();
					const editDialog = page.getByRole('dialog');
					await editDialog.waitFor({ state: 'visible' });
					await editDialog.getByLabel('Customer name').fill(`${customerName} Edited`);
					await editDialog.getByRole('button', { name: 'Save changes' }).click();
					await editDialog.waitFor({ state: 'detached' });
					const editedRow = page.locator('.customer-directory tbody tr[data-record-id]').filter({ hasText: 'ux-d-one@example.test' });
					await page.waitForFunction((email) =>
						[...document.querySelectorAll('.customer-directory tbody tr[data-record-id]')]
							.some((row) => row.textContent.includes(email) && row.textContent.includes('UX-D Browser Customer Edited')),
					'ux-d-one@example.test');
					if (await editedRow.getAttribute('data-record-id') !== activeCustomerId) {
						throw new Error('customers.html: editing a customer changed its document ID.');
					}

					await editedRow.getByRole('button', { name: `Delete ${customerName} Edited` }).click();
					const deleteDialog = page.getByRole('dialog', { name: `Delete ${customerName} Edited?` });
					await deleteDialog.waitFor({ state: 'visible' });
					if (!(await deleteDialog.textContent()).includes('permanently removed from your customer directory')) {
						throw new Error('customers.html: delete confirmation did not identify the customer action.');
					}
					await deleteDialog.getByRole('button', { name: 'Delete record' }).click();
					await deleteDialog.waitFor({ state: 'detached' });
					await page.waitForFunction((email) =>
						![...document.querySelectorAll('.customer-directory tbody tr[data-record-id]')]
							.some((row) => row.textContent.includes(email)), 'ux-d-one@example.test');
					await page.waitForFunction(() => {
						const button = document.querySelector('.page-actions .primary-button');
						return button && document.activeElement === button;
					});
				}

				const createButton = page.locator('.page-actions .primary-button').first();
				await createButton.click();
				const dialog = page.getByRole('dialog');
				await dialog.waitFor({ state: 'visible' });
				const dialogFits = await dialog.evaluate((element) => {
					const rect = element.getBoundingClientRect();
					return rect.left >= 0 && rect.right <= window.innerWidth + 1
						&& rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
				});
				if (!dialogFits) throw new Error(`${viewport.name} customers.html: the record form does not fit the viewport.`);
				await page.keyboard.press('Escape');
				await dialog.waitFor({ state: 'detached' });
			}

			if (file === 'appointments.html') {
				await page.waitForFunction(() =>
					document.querySelector('.appointments-page tbody')?.getAttribute('aria-busy') === 'false');
				const scheduleLayout = await page.evaluate(() => {
					const rect = selector => {
						const element = document.querySelector(selector);
						const bounds = element?.getBoundingClientRect();
						return bounds ? { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left, width: bounds.width, height: bounds.height } : null;
					};
					return {
						metrics: document.querySelectorAll('.appointments-metrics .stat-card').length,
						columns: document.querySelectorAll('.appointments-schedule thead th').length,
						toolbar: rect('.appointments-toolbar'),
						metricsRect: rect('.appointments-metrics'),
						schedule: rect('.appointments-schedule'),
						primaryAction: rect('.appointments-page .page-actions .primary-button'),
						pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
					};
				});
				if (scheduleLayout.metrics !== 4 || scheduleLayout.columns !== 6
					|| !scheduleLayout.toolbar || !scheduleLayout.metricsRect || !scheduleLayout.schedule
					|| !scheduleLayout.primaryAction || scheduleLayout.pageOverflow
					|| scheduleLayout.toolbar.bottom > scheduleLayout.metricsRect.top
					|| scheduleLayout.metricsRect.bottom > scheduleLayout.schedule.top) {
					throw new Error(`${viewport.name} appointments.html: schedule hierarchy or spacing is invalid: ${JSON.stringify(scheduleLayout)}`);
				}

				const periodFilter = page.getByLabel('Filter appointments by period');
				for (const [period, headingText] of [['week', 'This week'], ['month', 'This month'], ['today', 'Today']]) {
					await periodFilter.selectOption(period);
					if ((await page.locator('#appointmentsPeriodHeading').textContent()).trim() !== headingText) {
						throw new Error(`${viewport.name} appointments.html: period heading did not follow the selected period.`);
					}
				}

				const viewToggle = page.locator('#appointmentsCalendarViewButton');
				await viewToggle.click();
				if (await viewToggle.getAttribute('aria-pressed') !== 'true') {
					throw new Error(`${viewport.name} appointments.html: calendar view state was not exposed.`);
				}
				const calendarSpacing = await page.evaluate(() => {
					const grid = document.querySelector('#appointmentsCalendarGrid');
					const calendar = document.querySelector('#appointmentsCalendarView');
					const gridRect = grid.getBoundingClientRect();
					const bounds = [...grid.querySelectorAll('.calendar-day:not(.empty)')].map(day => day.getBoundingClientRect());
					return {
						overflow: calendar.scrollWidth > calendar.clientWidth + 1,
						dayWidth: Math.min(...bounds.map(day => day.width)),
						dayHeight: Math.min(...bounds.map(day => day.height)),
						allDaysInside: bounds.every(day => day.left >= gridRect.left - 1 && day.right <= gridRect.right + 1)
					};
				});
				if (calendarSpacing.overflow || !calendarSpacing.allDaysInside
					|| calendarSpacing.dayWidth < 32 || calendarSpacing.dayHeight < 40) {
					throw new Error(`${viewport.name} appointments.html: calendar spacing is too tight or overflowing: ${JSON.stringify(calendarSpacing)}`);
				}
				const todayKey = await page.evaluate(() => {
					const date = new Date();
					return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
				});
				const todayCell = page.locator(`#appointmentsCalendarGrid [data-date="${todayKey}"]`);
				await todayCell.click();
				if (await todayCell.getAttribute('aria-pressed') !== 'true'
					|| !(await page.locator('#appointmentsCalendarDayView').isVisible())) {
					throw new Error(`${viewport.name} appointments.html: selecting a date did not open the selected-day schedule.`);
				}
				const dayContent = page.locator('#appointmentsCalendarDaySlots');
				if (!await dayContent.locator('[data-calendar-edit], .appointment-day-empty').count()) {
					throw new Error(`${viewport.name} appointments.html: selected day has neither appointments nor a valid empty state.`);
				}
				await page.getByRole('button', { name: 'Back to month' }).click();
				const selectedDay = page.locator(`#appointmentsCalendarGrid [data-date="${todayKey}"]`);
				if (await selectedDay.getAttribute('aria-pressed') !== 'true') {
					throw new Error(`${viewport.name} appointments.html: selected day was lost when returning to the month.`);
				}
				await viewToggle.click();
				if (await viewToggle.getAttribute('aria-pressed') !== 'false') {
					throw new Error(`${viewport.name} appointments.html: switching back to the table did not update the view state.`);
				}

				if (viewport.width === 1440) {
					const customerName = 'UX-C Browser Customer';
					await page.getByRole('button', { name: 'New Appointment' }).click();
					const createDialog = page.getByRole('dialog', { name: 'Add Appointment' });
					await createDialog.waitFor({ state: 'visible' });
					const dialogFits = await createDialog.evaluate(element => {
						const bounds = element.getBoundingClientRect();
						const fields = [...element.querySelectorAll('.form-field')].map(field => field.getBoundingClientRect());
						return bounds.left >= 0 && bounds.right <= innerWidth + 1
							&& bounds.top >= 0 && bounds.bottom <= innerHeight + 1
							&& fields.every(field => field.width > 0 && field.height > 0);
					});
					if (!dialogFits) throw new Error('desktop appointments.html: appointment form spacing does not fit the viewport.');
					const customerSelect = createDialog.getByLabel('Customer');
					const customerOptions = await customerSelect.locator('option').evaluateAll(options =>
						options.map(option => ({ value: option.value, label: option.textContent.trim() })));
					const customerOption = customerOptions.find(option => option.label.includes('ux-c-browser@example.test'))
						|| customerOptions.find(option => option.label === customerName);
					if (!customerOption) {
						throw new Error(`appointments.html: the intended customer option was unavailable: ${JSON.stringify(customerOptions)}`);
					}
					await customerSelect.selectOption(customerOption.value);
					const today = await page.evaluate(() => {
						const date = new Date();
						return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
					});
					await createDialog.getByLabel('Booking date').fill(today);
					await createDialog.getByLabel('Booking time').fill('11:15');
					await createDialog.getByLabel('Service').fill('UX-E Browser Service');
					await createDialog.getByLabel('Staff member').fill('UX-E Browser Staff');
					if (await createDialog.getByLabel('Status').inputValue() !== 'pending') {
						throw new Error('appointments.html: new appointments must default to pending status.');
					}
					await createDialog.getByRole('button', { name: 'Add' }).click();
					try {
						await createDialog.waitFor({ state: 'detached' });
					} catch (error) {
						const formState = await createDialog.evaluate(dialog => ({
							error: dialog.querySelector('.app-modal-error')?.textContent,
							submitDisabled: dialog.querySelector('button[type="submit"]')?.disabled,
							fields: [...dialog.querySelectorAll('.form-field')].map(field => ({
								label: field.querySelector('label')?.textContent,
								value: field.querySelector('input, select')?.value
							}))
						}));
						throw new Error(`appointments.html: appointment creation did not complete: ${JSON.stringify(formState)}. ${error.message}`);
					}
					const appointmentRow = page.locator('.appointments-schedule tbody tr[data-record-id]').filter({ hasText: 'UX-E Browser Service' });
					await appointmentRow.waitFor({ state: 'visible' });
					const appointmentId = await appointmentRow.getAttribute('data-record-id');
					await appointmentRow.getByRole('button', { name: `Edit appointment with ${customerName}` }).click();
					const editDialog = page.getByRole('dialog', { name: 'Edit Appointment' });
					await editDialog.waitFor({ state: 'visible' });
					await editDialog.getByLabel('Service').fill('UX-E Edited Service');
					await editDialog.getByRole('button', { name: 'Save changes' }).click();
					await editDialog.waitFor({ state: 'detached' });
					const editedRow = page.locator('.appointments-schedule tbody tr[data-record-id]').filter({ hasText: 'UX-E Edited Service' });
					await editedRow.waitFor({ state: 'visible' });
					if (await editedRow.getAttribute('data-record-id') !== appointmentId) {
						throw new Error('appointments.html: editing changed the appointment document ID.');
					}
					await editedRow.getByRole('button', { name: `Delete appointment with ${customerName}` }).click();
					const deleteDialog = page.getByRole('dialog', { name: `Delete appointment for ${customerName}?` });
					await deleteDialog.waitFor({ state: 'visible' });
					if (!(await deleteDialog.textContent()).includes('UX-E Edited Service')) {
						throw new Error('appointments.html: delete confirmation did not identify the booked appointment details.');
					}
					await deleteDialog.getByRole('button', { name: 'Delete appointment' }).click();
					await deleteDialog.waitFor({ state: 'detached' });
					await page.waitForFunction(id => ![...document.querySelectorAll('.appointments-schedule tbody tr[data-record-id]')]
						.some(row => row.dataset.recordId === id), appointmentId);
				}

				await page.getByRole('button', { name: 'New Appointment' }).click();
				const appointmentDialog = page.getByRole('dialog', { name: 'Add Appointment' });
				await appointmentDialog.waitFor({ state: 'visible' });
				await page.keyboard.press('Escape');
				await appointmentDialog.waitFor({ state: 'detached' });
			}
		}

		if (consoleErrors.length) {
			failures.push(`${viewport.name}: browser errors: ${consoleErrors.join(' | ')}`);
		}
		await context.close();
		console.log(`PASS ${viewport.name} (${viewport.width}px): all authenticated pages loaded without horizontal overflow.`);
	}
} finally {
	await browser.close();
}

if (failures.length) throw new Error(failures.join('\n'));
