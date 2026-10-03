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
			if (result.overflow) throw new Error(`${viewport.name} ${file}: page-wide horizontal overflow detected.`);
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
