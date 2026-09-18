import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getApps, initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, terminate } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { createEmulatorAdmin } from './server/emulatorAdmin.mjs';
import { assertFunctionsEmulatorEnvironment, waitForFirestore } from './emulatorEnvironment.mjs';
import { initializeFirebaseClient, DEMO_PROJECT_ID } from '../js/firebase/clientEnvironment.js';
import { getLocalBusinessContext } from '../js/firebase/localBusinessContext.js';
import { createInvoiceDraftApi } from '../js/features/invoiceDraftApi.js';
import { createInvoiceDraftState } from '../js/features/invoiceDraftState.js';

test('frontend foundation reaches guarded emulator create/read callables with SDK Auth and demo routing', async () => {
    assertFunctionsEmulatorEnvironment(process.env);
    await waitForFirestore();
    const admin = createEmulatorAdmin();
    let client;
    const uid = 'frontend-foundation-owner';
    const environment = { local: true, projectId: DEMO_PROJECT_ID };
    try {
        // Test-only provisioning. Browser modules never import Admin or provision membership.
        await admin.auth.createUser({ uid, email: `${uid}@example.test`, password: 'local-foundation-test' });
        client = initializeFirebaseClient({ getApps, initializeApp, getAuth, connectAuthEmulator,
            getFirestore, connectFirestoreEmulator, getFunctions, connectFunctionsEmulator }, {}, environment);
        assert.equal(client.firebaseApp.options.projectId, DEMO_PROJECT_ID);
        await signInWithEmailAndPassword(client.auth, `${uid}@example.test`, 'local-foundation-test');
        const { businessId } = getLocalBusinessContext(environment, client.auth.currentUser);
        const business = admin.db.doc(`businesses/${businessId}`);
        await business.set({ ownerId: uid, active: true });
        await business.collection('members').doc(uid).set({ uid, role: 'owner', active: true });
        const api = createInvoiceDraftApi({ functions: client.functions, httpsCallable, environment, getCurrentUser: () => client.auth.currentUser });
        const route = { businessId, invoiceId: 'foundation-smoke' };
        const draft = { customerId: null, customerName: 'Local demo', customerEmail: null, customerAddress: null,
            currency: 'ZAR', issueDate: null, dueDate: null, lineItems: [] };
        assert.deepEqual(await api.saveInvoiceDraft({ ...route, draft }), { invoiceId: route.invoiceId, lifecycleStatus: 'draft' });
        const loaded = await api.getInvoiceDraft(route);
        const state = createInvoiceDraftState(route); state.adoptLoaded(loaded);
        assert.equal(state.snapshot().revision, 1);
        assert.deepEqual(state.snapshot().draft, draft);
        assert.deepEqual(state.snapshot().totals, { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 });
        assert.equal((await admin.db.doc(`invoices/${route.invoiceId}`).get()).exists, false);
        // Configured business ID is not authority: server rejects revoked membership.
        await business.collection('members').doc(uid).update({ active: false });
        await assert.rejects(api.getInvoiceDraft(route), error => error.details?.code === 'BUSINESS_ACCESS_DENIED');
        await signOut(client.auth);
        await assert.rejects(api.getInvoiceDraft(route), /Sign in/);
    } finally {
        if (client) { await terminate(client.firestore); await deleteApp(client.firebaseApp); }
        await admin.close();
    }
});
