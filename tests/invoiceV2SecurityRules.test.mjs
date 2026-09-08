import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, doc, getDocFromServer, getDocsFromServer, setDoc,
    updateDoc, deleteDoc, query, where, writeBatch, setLogLevel } from 'firebase/firestore';
import { assertEmulatorEnvironment, demoProjectId, waitForFirestore } from './emulatorEnvironment.mjs';

assertEmulatorEnvironment(process.env);
let environment;
let productionRules;
const clients = {};
const member = (uid, role = 'owner', active = true) => ({ uid, role, active });
const invoice = (businessId, totalMinor = 1540) => ({
    schemaVersion: 2, businessId, ownerId: businessId === 'business-a' ? 'user-a' : 'user-b',
    customer: { id: null, name: 'Customer', email: null, address: null },
    lifecycleStatus: 'draft', paymentStatus: 'not_due', totalMinor, amountPaidMinor: 0, balanceDueMinor: totalMinor
});
const invoicePath = (businessId = 'business-a', id = 'invoice-1') => `businesses/${businessId}/invoices/${id}`;
const memberPath = (uid, businessId = 'business-a') => `businesses/${businessId}/members/${uid}`;
const admin = callback => environment.withSecurityRulesDisabled(context => callback(context.firestore()));
const seed = (path, data) => admin(db => setDoc(doc(db, path), data));
const read = (db, businessId = 'business-a', id = 'invoice-1') => getDocFromServer(doc(db, invoicePath(businessId, id)));
const list = (db, businessId = 'business-a') => getDocsFromServer(collection(db, `businesses/${businessId}/invoices`));

before(async () => {
    await waitForFirestore();
    productionRules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
    environment = await initializeTestEnvironment({ projectId: demoProjectId,
        firestore: { host: '127.0.0.1', port: 8080,
            rules: await readFile(new URL('./firestore.invoiceV2.rules', import.meta.url), 'utf8') } });
    for (const uid of ['user-a', 'user-b', 'user-c', 'accountant', 'viewer', 'outsider']) {
        clients[uid] = environment.authenticatedContext(uid).firestore();
    }
    clients.guest = environment.unauthenticatedContext().firestore();
    setLogLevel('silent');
});
beforeEach(async () => {
    await environment.clearFirestore();
    await admin(async db => {
        const batch = writeBatch(db);
        for (const businessId of ['business-a', 'business-b']) {
            batch.set(doc(db, `businesses/${businessId}`), { name: businessId });
            batch.set(doc(db, invoicePath(businessId)), invoice(businessId));
            batch.set(doc(db, invoicePath(businessId, 'invoice-2')), invoice(businessId, 0));
        }
        for (const [uid, role] of [['user-a', 'owner'], ['user-c', 'staff'], ['accountant', 'accountant'], ['viewer', 'viewer']]) {
            batch.set(doc(db, memberPath(uid)), member(uid, role));
        }
        batch.set(doc(db, memberPath('user-b', 'business-b')), member('user-b'));
        await batch.commit();
    });
});
after(async () => {
    // A standalone run or future subsequent suite must not inherit this fixture.
    try { await environment?.clearFirestore(); }
    finally {
        await environment?.cleanup();
        if (productionRules) {
            const restored = await initializeTestEnvironment({ projectId: demoProjectId,
                firestore: { host: '127.0.0.1', port: 8080, rules: productionRules } });
            try {
                await restored.withSecurityRulesDisabled(async context => {
                    const db = context.firestore();
                    await setDoc(doc(db, memberPath('user-a')), member('user-a'));
                    await setDoc(doc(db, invoicePath()), invoice('business-a'));
                });
                // Same active member allowed by the fixture is denied by the
                // restored production rules. A failed restoration fails the suite.
                await assertFails(read(restored.authenticatedContext('user-a').firestore()));
            } finally {
                try { await restored.clearFirestore(); } finally { await restored.cleanup(); }
            }
        }
    }
});

for (const [uid, businessId] of [['user-a', 'business-a'], ['user-c', 'business-a'], ['accountant', 'business-a'], ['viewer', 'business-a'], ['user-b', 'business-b']]) {
    test(`${uid}: active member can read a known invoice and query ${businessId}`, async () => {
        assert.equal((await assertSucceeds(read(clients[uid], businessId))).data().totalMinor, 1540);
        const result = await assertSucceeds(list(clients[uid], businessId));
        assert.deepEqual(result.docs.map(snapshot => snapshot.id).sort(), ['invoice-1', 'invoice-2']);
        const filtered = query(collection(clients[uid], `businesses/${businessId}/invoices`), where('totalMinor', '==', 0));
        assert.deepEqual((await assertSucceeds(getDocsFromServer(filtered))).docs.map(snapshot => snapshot.id), ['invoice-2']);
    });
}
for (const [uid, businessId] of [['user-a', 'business-b'], ['user-b', 'business-a'], ['user-c', 'business-b'], ['outsider', 'business-a'], ['guest', 'business-a']]) {
    test(`${uid}: known IDs and queries cannot bypass isolation in ${businessId}`, async () => {
        await assertFails(read(clients[uid], businessId));
        await assertFails(list(clients[uid], businessId));
        await assertFails(read(clients[uid], businessId, 'missing-id'));
    });
}
test('membership in two businesses grants separate scoped reads to both', async () => {
    await seed(memberPath('user-a', 'business-b'), member('user-a', 'viewer'));
    for (const businessId of ['business-a', 'business-b']) {
        await assertSucceeds(read(clients['user-a'], businessId));
        assert.equal((await assertSucceeds(list(clients['user-a'], businessId))).size, 2);
    }
});
test('collection-group query cannot read invoices across tenants', async () => {
    await assertFails(getDocsFromServer(collectionGroup(clients['user-a'], 'invoices')));
});
for (const uid of ['user-a', 'user-c', 'accountant', 'viewer', 'outsider', 'guest']) {
    test(`${uid}: direct invoice create, replacement and delete are denied`, async () => {
        const db = clients[uid];
        await assertFails(setDoc(doc(db, invoicePath('business-a', 'forged')), invoice('business-a')));
        await assertFails(setDoc(doc(db, invoicePath()), invoice('business-a', 1)));
        await assertFails(deleteDoc(doc(db, invoicePath())));
    });
    for (const [field, value] of [['customer', { name: 'Changed' }], ['totalMinor', 1], ['lifecycleStatus', 'issued'], ['paymentStatus', 'paid']]) {
        test(`${uid}: cannot update invoice ${field}`, async () => {
            await assertFails(updateDoc(doc(clients[uid], invoicePath()), { [field]: value }));
        });
    }
}
for (const removal of ['inactive', 'deleted']) test(`${removal} membership revokes direct reads and queries`, async () => {
    await assertSucceeds(read(clients['user-a']));
    if (removal === 'inactive') await seed(memberPath('user-a'), member('user-a', 'owner', false));
    else await admin(db => deleteDoc(doc(db, memberPath('user-a'))));
    await assertFails(read(clients['user-a'])); await assertFails(list(clients['user-a']));
});
for (const [label, data] of [
    ['missing active', { uid: 'user-a', role: 'owner' }],
    ['string active', { uid: 'user-a', role: 'owner', active: 'true' }],
    ['numeric active', { uid: 'user-a', role: 'owner', active: 1 }],
    ['wrong uid', member('user-b')], ['missing uid', { role: 'owner', active: true }]
]) test(`malformed membership denies access: ${label}`, async () => {
    await seed(memberPath('user-a'), data);
    await assertFails(read(clients['user-a'])); await assertFails(list(clients['user-a']));
});
for (const role of ['OWNER', 'unknown', null]) test(`backend-seeded role ${role} does not change active-member read policy`, async () => {
    await seed(memberPath('user-a'), member('user-a', role));
    await assertSucceeds(read(clients['user-a']));
    await assertFails(updateDoc(doc(clients['user-a'], invoicePath()), { totalMinor: 1 }));
});
test('client cannot enroll itself in another business', async () => {
    await assertFails(setDoc(doc(clients['user-a'], memberPath('user-a', 'business-b')), member('user-a')));
    await assertFails(read(clients['user-a'], 'business-b'));
});
test('staff cannot elevate its role', async () => {
    await assertFails(updateDoc(doc(clients['user-c'], memberPath('user-c')), { role: 'owner' }));
});
test('disabled member cannot reactivate itself', async () => {
    await seed(memberPath('user-a'), member('user-a', 'owner', false));
    await assertFails(updateDoc(doc(clients['user-a'], memberPath('user-a')), { active: true }));
    await assertFails(read(clients['user-a']));
});
for (const uid of ['user-a', 'user-c', 'outsider', 'guest']) test(`${uid}: business and membership documents remain backend-managed`, async () => {
    const db = clients[uid];
    for (const [existing, fresh, data] of [
        ['businesses/business-a', 'businesses/new-business', { name: 'Forged' }],
        [memberPath('user-a'), memberPath('new-user'), member('new-user')]
    ]) {
        await assertFails(getDocFromServer(doc(db, existing)));
        await assertFails(setDoc(doc(db, fresh), data));
        await assertFails(updateDoc(doc(db, existing), data));
        await assertFails(deleteDoc(doc(db, existing)));
    }
});
test('atomic self-enrollment plus financial write cannot bypass either denial', async () => {
    const db = clients.outsider; const batch = writeBatch(db);
    batch.set(doc(db, memberPath('outsider')), member('outsider'));
    batch.set(doc(db, invoicePath('business-a', 'forged')), invoice('business-a'));
    await assertFails(batch.commit()); await assertFails(read(db));
});
for (const path of ['arbitrary/doc', 'businesses/business-a/secrets/doc', 'businesses/business-a/invoices/invoice-1/private/doc', 'invoices/legacy']) {
    test(`catch-all denies unspecified path: ${path}`, async () => {
        await seed(path, { value: 1 }); const target = doc(clients['user-a'], path);
        await assertFails(getDocFromServer(target)); await assertFails(setDoc(target, { value: 2 }));
        await assertFails(deleteDoc(target));
    });
}
