import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const playwrightBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.tmpdir(), 'businessboss-playwright');
const ports = [4173, 8080, 9099, 5001];
const fixtureCommandPath = path.join(root, '.firebase', 'invoice-browser-command.json');
const isFree = (port) => new Promise((resolve) => {
	const probe = net.createServer();
	probe.once('error', () => resolve(false));
	probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(() => resolve(true)));
});
const waitForExit = (child) => new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));

const occupied = [];
for (const port of ports) if (!await isFree(port)) occupied.push(port);
if (occupied.length) throw new Error(`Cannot start the authenticated browser fixture; occupied ports: ${occupied.join(', ')}.`);

const fixture = spawn(process.execPath, ['tests/runRules.mjs', '--frontend-browser'], {
	cwd: root,
	env: process.env,
	stdio: ['ignore', 'pipe', 'pipe'],
	windowsHide: true
});
const fixtureExit = waitForExit(fixture);
let ready = false;
let fixtureOutput = '';
let acceptanceResult = 1;

try {
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('Timed out waiting for BUSINESSBOSS_BROWSER_READY.')), 25 * 60_000);
		fixture.stdout.on('data', (data) => {
			const text = data.toString();
			process.stdout.write(text);
			fixtureOutput = (fixtureOutput + text).slice(-8192);
			if (fixtureOutput.includes('BUSINESSBOSS_BROWSER_READY:')) {
				ready = true;
				clearTimeout(timeout);
				resolve();
			}
		});
		fixture.stderr.on('data', (data) => process.stderr.write(data));
		fixture.once('error', (error) => { clearTimeout(timeout); reject(error); });
		fixture.once('exit', (code, signal) => {
			if (!ready) {
				clearTimeout(timeout);
				reject(new Error(`Fixture exited before readiness (${signal || code}).`));
			}
		});
	});

	const acceptance = spawn(process.execPath, ['tests/authenticatedUxBResponsiveAcceptance.mjs'], {
		cwd: root,
		env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsersPath },
		stdio: 'inherit',
		windowsHide: true
	});
	const result = await waitForExit(acceptance);
	acceptanceResult = result.code ?? 1;
	if (result.signal) acceptanceResult = 1;
} finally {
	if (fixture.exitCode === null && fixture.signalCode === null) {
		await fs.writeFile(fixtureCommandPath, JSON.stringify({ action: 'stop' }));
	}
	let stopped = await Promise.race([
		fixtureExit,
		new Promise((resolve) => setTimeout(() => resolve(null), 30_000))
	]);
	if (!stopped && fixture.exitCode === null && fixture.signalCode === null) {
		fixture.kill('SIGTERM');
		stopped = await Promise.race([
			fixtureExit,
			new Promise((resolve) => setTimeout(() => resolve(null), 15_000))
		]);
	}
	if (!stopped) throw new Error('Owned fixture did not exit after graceful and signal cleanup.');
	console.log(`Authenticated UX-B fixture stopped (${stopped.signal || stopped.code}).`);
	for (const port of ports) console.log(`Port ${port} released: ${await isFree(port) ? 'YES' : 'NO'}`);
}

process.exitCode = acceptanceResult;
