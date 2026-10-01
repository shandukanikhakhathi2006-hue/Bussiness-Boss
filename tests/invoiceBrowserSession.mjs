// Optional, bounded manual browser verification under the SAME guarded harness.
// Not imported by the app and never hosted by this local static server.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { createEmulatorAdmin } from './server/emulatorAdmin.mjs';
import { assertFunctionsEmulatorEnvironment, demoProjectId, waitForFirestore } from './emulatorEnvironment.mjs';
import { DEMO_BUSINESS_ID } from '../js/firebase/localBusinessContext.js';

assertFunctionsEmulatorEnvironment(process.env); await waitForFirestore();
const root = path.resolve(import.meta.dirname, '..');
const commandFile = path.join(root, '.firebase', 'invoice-browser-command.json');
const statusFile = path.join(root, '.firebase', 'invoice-browser-status.json');
const admin = createEmulatorAdmin(); let app, server;
const uid = 'stage9nb-browser', email = 'stage9nb-browser@example.test', password = 'local-browser-test';
const status = async value => fs.writeFile(statusFile, JSON.stringify(value));
try {
    await status({ ready: false, phase: 'provisioning', pid: process.pid });
    console.log('Browser fixture: provisioning synthetic owner after emulator startup.');
    await fs.rm(commandFile, { force: true });
    await admin.auth.createUser({ uid, email, password });
    await admin.db.doc(`businesses/${DEMO_BUSINESS_ID}`).set({ ownerId: uid, active: true });
    await admin.db.doc(`businesses/${DEMO_BUSINESS_ID}/members/${uid}`).set({ uid, role: 'owner', active: true });
    await admin.db.doc(`users/${uid}`).set({ fullName: 'Local demo owner', email });
    app = initializeApp({ apiKey: 'demo-api-key', projectId: demoProjectId });
    const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099');
    const functions = getFunctions(app, 'africa-south1'); connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    await signInWithEmailAndPassword(auth, email, password);
    // Real authenticated callable responses prove readiness, not just listeners.
    // Invalid envelopes warm the handlers without creating any invoice.
    for (const name of ['saveInvoiceDraft', 'getInvoiceDraft', 'updateInvoiceDraft']) {
        await assert.rejects(httpsCallable(functions, name, { timeout: 120000 })({}), error => error.details?.code === 'INVALID_REQUEST');
        console.log(`Browser fixture: ${name} authenticated readiness verified.`);
    }
    server = http.createServer(async (request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
            if (!/^\/(?:js\/|images\/)?[A-Za-z0-9_./-]+\.(?:html|js|css|png|jpe?g|svg)$/i.test(pathname)
                || pathname.includes('..') || /^\/(tests|server|functions|node_modules)\//.test(pathname)) throw Error();
            const filename = path.resolve(root, '.' + pathname);
            if (!filename.startsWith(root + path.sep)) throw Error();
            const body = await fs.readFile(filename);
            const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
            response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(body);
        } catch { response.writeHead(404); response.end('Not found'); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4173, '127.0.0.1', resolve); });
    await status({ ready: true, url: 'http://127.0.0.1:4173/invoices-v2.html?emulator=1', email });
    console.log('Browser fixture ready on 127.0.0.1:4173 (synthetic local owner only).');
    console.log(`BUSINESSBOSS_BROWSER_READY:${process.env.BUSINESSBOSS_EMULATOR_TOKEN}`);
    // Manual browser acceptance needs one bounded but practical session. The
    // enclosing harness keeps a one-minute grace period for orderly cleanup.
    const deadline = Date.now() + 60 * 60_000;
    let previous = '';
    while (Date.now() < deadline) {
        const raw = await fs.readFile(commandFile, 'utf8').catch(() => '');
        if (raw && raw !== previous) {
            previous = raw; const command = JSON.parse(raw);
            if (command.action === 'stop') break;
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(command.invoiceId)) throw Error('Invalid browser test invoice ID.');
            const route = { businessId: DEMO_BUSINESS_ID, invoiceId: command.invoiceId };
            const loaded = (await httpsCallable(functions, 'getInvoiceDraft')(route)).data;
            if (command.action === 'other-writer') {
                loaded.draft.customerName = 'Other browser writer';
                const result = (await httpsCallable(functions, 'updateInvoiceDraft')({ ...route, expectedRevision: loaded.revision, input: loaded.draft })).data;
                await status({ ready: true, writerRevision: result.revision });
            } else if (command.action === 'inspect') {
                const stored = (await admin.db.doc(`businesses/${DEMO_BUSINESS_ID}/invoices/${command.invoiceId}`).get()).data();
                const legacy = await admin.db.doc(`invoices/${command.invoiceId}`).get();
                assert.equal(stored.revision, loaded.revision);
                assert.equal(legacy.exists, false);
                await status({ ready: true, invoiceId: loaded.invoiceId, revision: loaded.revision, draft: loaded.draft, totals: loaded.totals,
                    storedRevision: stored.revision, storedTotalMinor: stored.totalMinor, legacyExists: legacy.exists });
            }
        }
        await delay(500);
    }
} finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (app) await deleteApp(app); await admin.close(); await status({ ready: false, stopped: true });
}
