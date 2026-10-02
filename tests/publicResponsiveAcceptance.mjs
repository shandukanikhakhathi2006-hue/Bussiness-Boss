import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.tmpdir(), 'businessboss-playwright');
process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
const { chromium } = await import('playwright');

const mimeTypes = new Map([
	['.css', 'text/css; charset=utf-8'],
	['.html', 'text/html; charset=utf-8'],
	['.js', 'text/javascript; charset=utf-8'],
	['.jpeg', 'image/jpeg'],
	['.jpg', 'image/jpeg'],
	['.png', 'image/png'],
	['.svg', 'image/svg+xml'],
	['.webp', 'image/webp']
]);

const server = createServer(async (request, response) => {
	try {
		const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
		const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
		const filePath = path.resolve(root, relativePath);
		if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
			response.writeHead(403).end('Forbidden');
			return;
		}
		const content = await readFile(filePath);
		response.writeHead(200, { 'content-type': mimeTypes.get(path.extname(filePath)) ?? 'application/octet-stream' });
		response.end(content);
	} catch {
		response.writeHead(404).end('Not found');
	}
});

const pages = [
	{ file: 'index.html', kind: 'marketing', action: '.hero-actions .button' },
	{ file: 'features.html', kind: 'marketing', action: '.closing-cta .button' },
	{ file: 'pricing.html', kind: 'marketing', action: '.pricing-information .button' },
	{ file: 'Contact.html', kind: 'marketing', action: '.contact-information .button' },
	{ file: 'login.html', kind: 'auth', action: '.login-container button[type="submit"]', form: '.login-container' },
	{ file: 'signup.html', kind: 'auth', action: '.signup-btn', form: '.signup-form' },
	{ file: 'forgot-password.html', kind: 'auth', action: '.forgot-password-form button[type="submit"]', form: '.forgot-password-form' }
];
const viewports = [
	{ width: 1440, height: 900 },
	{ width: 1024, height: 900 },
	{ width: 768, height: 1024 },
	{ width: 390, height: 844 },
	{ width: 320, height: 740 }
];

let browser;
let checks = 0;
let serverPort;
const failures = [];

try {
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
		serverPort = server.address().port;
		browser = await chromium.launch({ headless: true });
		const baseUrl = `http://127.0.0.1:${serverPort}`;
	const page = await browser.newPage();
	const browserErrors = [];
	page.on('pageerror', error => browserErrors.push(error.message));
	page.on('console', message => {
		if (message.type() === 'error') browserErrors.push(message.text());
	});

	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		for (const target of pages) {
			const response = await page.goto(`${baseUrl}/${target.file}`, { waitUntil: 'domcontentloaded' });
			assert.equal(response?.status(), 200, `${target.file} should load successfully at ${viewport.width}px.`);

			const heading = page.locator('h1');
			assert.equal(await heading.count(), 1, `${target.file} should have one h1 at ${viewport.width}px.`);
			assert.equal(await heading.isVisible(), true, `${target.file} h1 should be visible at ${viewport.width}px.`);
			const layoutWidth = await page.evaluate(() => document.documentElement.clientWidth);

			const action = page.locator(target.action).first();
			assert.equal(await action.isVisible(), true, `${target.file} primary action should be visible at ${viewport.width}px.`);
			const actionBounds = await action.boundingBox();
			assert.ok(actionBounds && actionBounds.x >= -1 && actionBounds.x + actionBounds.width <= layoutWidth + 1,
				`${target.file} primary action should fit the viewport at ${viewport.width}px.`);

			if (target.form) {
				const form = page.locator(target.form);
				assert.equal(await form.isVisible(), true, `${target.file} form should be visible at ${viewport.width}px.`);
				const formBounds = await form.boundingBox();
				assert.ok(formBounds && formBounds.x >= -1 && formBounds.x + formBounds.width <= layoutWidth + 1,
					`${target.file} form should fit the viewport at ${viewport.width}px.`);
				const controlsFit = await form.locator('input, textarea, select, button').evaluateAll(elements =>
					elements.every(element => {
						const checkboxLabel = element instanceof HTMLInputElement && element.type === 'checkbox'
							? element.closest('label')
							: null;
						const rect = (checkboxLabel ?? element).getBoundingClientRect();
						return rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1 && rect.height >= 40;
					}));
				assert.equal(controlsFit, true, `${target.file} form controls should fit and remain comfortably sized at ${viewport.width}px.`);
			}

			if (target.file === 'index.html') {
				const copy = await page.locator('body').innerText();
				assert.doesNotMatch(copy, /R\s*24,850|12\.5%|Payment received|No card required|Set up in minutes/i,
					'Homepage should not present sample metrics or unverified signup promises as real.');
			}

			if (target.file === 'features.html') {
				const copy = await page.locator('body').innerText();
				assert.match(copy, /manually/i, 'Payment records should be described as manual entries.');
				assert.doesNotMatch(copy, /inventory management|WhatsApp reminders|API access|multiple branches|staff management|automated reminders|Peach Payments/i,
					'Features page should not advertise unverified functionality.');
			}

			if (target.file === 'pricing.html') {
				const copy = await page.locator('body').innerText();
				assert.doesNotMatch(copy, /R199|free trial|most popular|inventory management|WhatsApp reminders|API access|multiple branches|staff management/i,
					'Pricing page should not advertise unverified prices, tiers, or differentiators.');
			}

			if (target.file === 'Contact.html') {
				assert.equal(await page.locator('form').count(), 0, 'Contact page should not show a non-delivering form.');
				assert.equal(await page.locator('a[href^="mailto:"]').count(), 0, 'Contact page should not select an unverified email address.');
			}

			const layout = await page.evaluate(() => ({
				viewportWidth: window.innerWidth,
				layoutWidth: document.documentElement.clientWidth,
				documentWidth: document.documentElement.scrollWidth,
				bodyWidth: document.body.scrollWidth,
				heading: (() => {
					const rect = document.querySelector('h1').getBoundingClientRect();
					return { left: rect.left, right: rect.right };
				})(),
				imagesWithinViewport: [...document.images].every(image => {
					const rect = image.getBoundingClientRect();
					return rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1;
				})
			}));
			assert.ok(layout.documentWidth <= layout.layoutWidth + 1 && layout.bodyWidth <= layout.layoutWidth + 1,
				`${target.file} must not overflow horizontally at ${viewport.width}px (layout ${layout.layoutWidth}px, document ${layout.documentWidth}px, body ${layout.bodyWidth}px).`);
			assert.ok(layout.heading.left >= -1 && layout.heading.right <= layout.layoutWidth + 1,
				`${target.file} h1 must stay within the viewport at ${viewport.width}px.`);
			assert.equal(layout.imagesWithinViewport, true, `${target.file} images should stay within the viewport at ${viewport.width}px.`);

			if (target.kind === 'marketing') {
				const toggle = page.locator('.nav-menu-toggle');
				if (viewport.width <= 620) {
					assert.equal(await toggle.getAttribute('aria-label'), 'Open site navigation');
					await toggle.click();
					assert.equal(await toggle.getAttribute('aria-expanded'), 'true', `${target.file} mobile menu should open.`);
					assert.equal(await toggle.getAttribute('aria-label'), 'Close site navigation');
					const firstLink = page.locator('#public-navigation-panel .nav-links a').first();
					assert.equal(await firstLink.isVisible(), true,
						`${target.file} mobile links should be visible when open.`);
					const menuBounds = await page.locator('#public-navigation-panel').boundingBox();
					const linkBounds = await firstLink.boundingBox();
					assert.ok(menuBounds && menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= viewport.width,
						`${target.file} mobile menu should fit the viewport.`);
					assert.ok(linkBounds && linkBounds.height >= 44,
						`${target.file} mobile navigation links should have comfortable touch targets.`);
					await page.keyboard.press('Escape');
					assert.equal(await toggle.getAttribute('aria-expanded'), 'false', `${target.file} Escape should close the mobile menu.`);
					assert.equal(await toggle.evaluate(element => document.activeElement === element), true,
						`${target.file} Escape should restore focus to the menu button.`);
					await toggle.click();
					await page.locator('#public-navigation-panel .nav-links a').first().click();
					assert.match(new URL(page.url()).pathname, /\/features\.html$/,
						`${target.file} mobile navigation link should reach its destination.`);
					await page.goto(`${baseUrl}/${target.file}`, { waitUntil: 'domcontentloaded' });
				} else {
					assert.equal(await page.locator('#public-navigation-panel .nav-links a').first().isVisible(), true,
						`${target.file} desktop navigation should be visible.`);
				}
			}

			checks += 1;
		}
	}

	assert.deepEqual(browserErrors, [], `Public/auth pages should not emit uncaught browser errors: ${browserErrors.join(' | ')}`);
	console.log(`Public responsiveness acceptance: PASS (${checks} page/viewport checks across ${pages.length} pages and ${viewports.length} viewports).`);
} catch (error) {
	failures.push(error);
	console.error(error.stack ?? error);
} finally {
	if (browser) await browser.close();
	if (server.listening) await new Promise(resolve => server.close(resolve));
	if (serverPort) console.log(`Public acceptance server port ${serverPort} released.`);
}

if (failures.length) process.exitCode = 1;
