import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getApps, initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, terminate } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { createEmulatorAdmin } from './server/emulatorAdmin.mjs';
import { assertFunctionsEmulatorEnvironment, waitForFirestore } from './emulatorEnvironment.mjs';
import { initializeFirebaseClient, DEMO_PROJECT_ID } from '../js/firebase/clientEnvironment.js';
import { getLocalBusinessContext } from '../js/firebase/localBusinessContext.js';
import { createInvoiceDraftApi } from '../js/features/invoiceDraftApi.js';
import { createInvoiceDraftWorkflow } from '../js/features/invoiceDraftWorkflow.js';

test('real editor state create/read 1, update/read 2 and 3, other writer 4, stale conflict, explicit reload, save/read 5', async () => {
    assertFunctionsEmulatorEnvironment(process.env); await waitForFirestore();
    const admin = createEmulatorAdmin(); let client;
    try {
        const uid = 'editor-workflow-owner', environment = { local: true, projectId: DEMO_PROJECT_ID };
        await admin.auth.createUser({ uid, email: `${uid}@example.test`, password: 'local-editor-test' });
        client = initializeFirebaseClient({ getApps, initializeApp, getAuth, connectAuthEmulator,
            getFirestore, connectFirestoreEmulator, getFunctions, connectFunctionsEmulator }, {}, environment);
        await signInWithEmailAndPassword(client.auth, `${uid}@example.test`, 'local-editor-test');
        const { businessId } = getLocalBusinessContext(environment, client.auth.currentUser);
        const business = admin.db.doc(`businesses/${businessId}`);
        await business.set({ ownerId: uid, active: true }); await business.collection('members').doc(uid).set({ uid, role: 'owner', active: true });
        const api = createInvoiceDraftApi({ functions: client.functions, httpsCallable, environment, getCurrentUser: () => client.auth.currentUser });
        let number = 0;
        const editor = createInvoiceDraftWorkflow({ environment, businessId, api, makeId: () => `editor-e2e-${++number}` });
        editor.newDraft(); const id = editor.snapshot().invoiceId, lineId = editor.snapshot().form.lineItems[0].id;
        editor.edit('customerName', 'Original'); editor.edit('description', 'Consulting', lineId); editor.edit('unitPrice', '10.50', lineId);
        editor.edit('quantity', '1.500', lineId); editor.edit('taxPercent', '15.00', lineId);
        assert.equal(await editor.save(), true); assert.equal(editor.snapshot().revision, 1);
        editor.edit('customerName', 'Edit two'); assert.equal(await editor.save(), true); assert.equal(editor.snapshot().revision, 2);
        editor.edit('customerName', 'Edit three'); assert.equal(await editor.save(), true); assert.equal(editor.snapshot().revision, 3);
        const other = await api.getInvoiceDraft({ businessId, invoiceId: id }); other.draft.customerName = 'Other writer';
        assert.deepEqual(await api.updateInvoiceDraft({ businessId, invoiceId: id, expectedRevision: 3, input: other.draft }), { invoiceId: id, revision: 4 });
        editor.edit('customerName', 'Unsaved conflict'); const unsaved = editor.snapshot().form;
        assert.equal(await editor.save(), false); assert.equal(editor.snapshot().revision, 3); assert.equal(editor.snapshot().status, 'conflict');
        assert.deepEqual(editor.snapshot().form, unsaved); assert.equal(await editor.reload(false), false);
        assert.equal(await editor.reload(true), true); assert.equal(editor.snapshot().revision, 4); assert.equal(editor.snapshot().form.customerName, 'Other writer');
        editor.edit('customerName', 'Final verified'); assert.equal(await editor.save(), true); assert.equal(editor.snapshot().revision, 5);
        const stored = (await business.collection('invoices').doc(id).get()).data();
        assert.equal(stored.revision, 5); assert.equal(stored.customer.name, 'Final verified');
        assert.equal(stored.lineItems[0].quantity, '1.500'); assert.equal(stored.lineItems[0].unitPriceMinor, 1050);
        assert.equal(stored.totalMinor, 1811); assert.equal(editor.snapshot().totals.totalMinor, stored.totalMinor);
        assert.equal((await admin.db.doc(`invoices/${id}`).get()).exists, false);
    } finally { if (client) { await terminate(client.firestore); await deleteApp(client.firebaseApp); } await admin.close(); }
});
