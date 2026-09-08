import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where, Timestamp, serverTimestamp, setLogLevel } from 'firebase/firestore';

import { assertEmulatorEnvironment, demoProjectId, waitForFirestore } from './emulatorEnvironment.mjs';

// Never discover a host/project from production configuration or SDK defaults.
const projectId = demoProjectId;
assertEmulatorEnvironment(process.env);

let environment;
let a;
let b;
let guest;
const createdAt = Timestamp.fromMillis(1000);
const later = Timestamp.fromMillis(2000);
const record = (ownerId = 'user-a') => ({ ownerId, createdAt, amount: 100, status: 'pending' });
const profile = () => ({ fullName: 'User A', email: 'a@example.test', phone: '123', photoURL: '', createdAt, updatedAt: createdAt });
const collections = ['customers', 'bookings', 'expenses', 'messages', 'invoices', 'payments'];
const protectedFields = {
    invoices: ['paidAt', 'paymentId', 'paymentReference', 'paymentProvider'],
    payments: ['provider', 'providerTransactionId', 'paymentReference']
};
const ref = (db, name, id = 'a') => doc(db, name, id);
const seed = (name, id, value) => environment.withSecurityRulesDisabled(context => setDoc(ref(context.firestore(), name, id), value));

before(async () => {
    await waitForFirestore();
    environment = await initializeTestEnvironment({
        projectId,
        firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') }
    });
    a = environment.authenticatedContext('user-a').firestore();
    b = environment.authenticatedContext('user-b').firestore();
    guest = environment.unauthenticatedContext().firestore();
    setLogLevel('silent'); // Expected permission denials are asserted, not console errors.
});
beforeEach(async () => { await environment.clearFirestore(); });
after(async () => { await environment?.cleanup(); });

test('users: allowlisted create, read and update work', async () => {
    await assertSucceeds(setDoc(ref(a, 'users', 'user-a'), profile()));
    assert.equal((await assertSucceeds(getDoc(ref(a, 'users', 'user-a')))).data().fullName, 'User A');
    await assertSucceeds(updateDoc(ref(a, 'users', 'user-a'), { fullName: 'Changed', email: 'new@example.test', phone: '456', photoURL: 'avatar', updatedAt: later }));
});
for (const field of ['plan', 'planUpdatedAt', 'role']) {
    test(`users: raw SDK create rejects ${field}`, async () => {
        await assertFails(setDoc(ref(a, 'users', 'user-a'), { ...profile(), [field]: 'forged' }));
    });
    for (const action of ['add', 'change', 'remove']) {
        test(`users: raw SDK ${action} rejects ${field}`, async () => {
            await seed('users', 'user-a', { ...profile(), ...(action === 'add' ? {} : { [field]: 'server-value' }) });
            await assertFails(updateDoc(ref(a, 'users', 'user-a'), { [field]: action === 'remove' ? deleteField() : 'forged' }));
        });
    }
}
test('users: createdAt changes and profile deletion are denied', async () => {
    await seed('users', 'user-a', profile());
    await assertFails(updateDoc(ref(a, 'users', 'user-a'), { createdAt: later }));
    await assertFails(deleteDoc(ref(a, 'users', 'user-a')));
});
for (const [label, db] of [['other user', () => b], ['unauthenticated', () => guest]]) {
    test(`users: ${label} cannot create another profile`, async () => {
        await assertFails(setDoc(ref(db(), 'users', 'user-a'), profile()));
    });
    test(`users: ${label} cannot read, update, replace or delete a known profile`, async () => {
        await seed('users', 'user-a', profile());
        const target = ref(db(), 'users', 'user-a');
        await assertFails(getDoc(target));
        await assertFails(updateDoc(target, { fullName: 'Attack' }));
        await assertFails(setDoc(target, profile()));
        await assertFails(deleteDoc(target));
    });
}

for (const name of collections) {
    test(`${name}: owner create/read/update/delete succeeds`, async () => {
        const target = ref(a, name);
        await assertSucceeds(setDoc(target, record()));
        assert.equal((await assertSucceeds(getDoc(target))).data().ownerId, 'user-a');
        await assertSucceeds(updateDoc(target, { amount: 250, status: 'paid', updatedAt: later }));
        await assertSucceeds(deleteDoc(target));
    });
    test(`${name}: raw SDK rejects forged and missing create ownership`, async () => {
        await assertFails(setDoc(ref(a, name), record('user-b')));
        await assertFails(setDoc(ref(a, name), { createdAt }));
    });
    for (const field of ['ownerId', 'createdAt']) {
        for (const action of ['change', 'remove']) {
            test(`${name}: owner cannot ${action} ${field}`, async () => {
                await seed(name, 'a', record());
                await assertFails(updateDoc(ref(a, name), { [field]: action === 'remove' ? deleteField() : field === 'ownerId' ? 'user-b' : later }));
            });
        }
    }
    test(`${name}: replacement cannot drop creation metadata`, async () => {
        await seed(name, 'a', record());
        await assertFails(setDoc(ref(a, name), { ownerId: 'user-a', amount: 200 }));
    });
    for (const [label, db] of [['other user', () => b], ['unauthenticated', () => guest]]) {
        test(`${name}: ${label} cannot read/update/replace/delete a known ID`, async () => {
            await seed(name, 'a', record());
            const target = ref(db(), name);
            await assertFails(getDoc(target));
            await assertFails(updateDoc(target, { amount: 999 }));
            await assertFails(setDoc(target, record('user-b')));
            await assertFails(deleteDoc(target));
        });
    }
    test(`${name}: unauthenticated create denied`, async () => {
        await assertFails(setDoc(ref(guest, name), record()));
    });
    test(`${name}: scoped queries succeed for each owner; foreign and unscoped queries fail`, async () => {
        await seed(name, 'a', record());
        await seed(name, 'b', record('user-b'));
        for (const [db, uid, id] of [[a, 'user-a', 'a'], [b, 'user-b', 'b']]) {
            const result = await assertSucceeds(getDocs(query(collection(db, name), where('ownerId', '==', uid))));
            assert.deepEqual(result.docs.map(item => item.id), [id]);
        }
        await assertFails(getDocs(collection(a, name)));
        await assertFails(getDocs(query(collection(a, name), where('ownerId', '==', 'user-b'))));
        await assertFails(getDocs(query(collection(guest, name), where('ownerId', '==', 'user-a'))));
    });
}

test('bookings: existing completion fields remain owner-editable', async () => {
    await seed('bookings', 'a', record());
    await assertSucceeds(setDoc(ref(a, 'bookings'), { status: 'completed', completedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true }));
});
test('payments: legacy manual amount/status/method remain owner-editable', async () => {
    await assertSucceeds(setDoc(ref(a, 'payments'), { ...record(), method: 'Cash' }));
    await assertSucceeds(updateDoc(ref(a, 'payments'), { amount: 300, status: 'received', method: 'Bank' }));
});
for (const [name, fields] of Object.entries(protectedFields)) {
    for (const field of fields) {
        for (const value of ['forged', null]) {
            test(`${name}: raw SDK create rejects ${field}=${value}`, async () => {
                await assertFails(setDoc(ref(a, name), { ...record(), [field]: value }));
            });
        }
        for (const action of ['add', 'change', 'remove']) {
            test(`${name}: raw SDK update rejects ${action} ${field}`, async () => {
                await seed(name, 'a', { ...record(), ...(action === 'add' ? {} : { [field]: 'server-value' }) });
                await assertFails(updateDoc(ref(a, name), { [field]: action === 'remove' ? deleteField() : 'forged' }));
            });
        }
    }
    test(`${name}: manual updates preserve seeded provider metadata`, async () => {
        const metadata = Object.fromEntries(fields.map(field => [field, 'server-value']));
        await seed(name, 'a', { ...record(), ...metadata });
        await assertSucceeds(updateDoc(ref(a, name), { amount: 400, status: 'paid' }));
        const saved = (await getDoc(ref(a, name))).data();
        for (const field of fields) assert.equal(saved[field], 'server-value');
    });
    test(`${name}: legacy rules permit arbitrary unprotected fields and owner deletion`, async () => {
        await assertSucceeds(setDoc(ref(a, name), { ownerId: 'user-a', amount: -1, status: 'anything', customField: true }));
        await assertSucceeds(deleteDoc(ref(a, name)));
        await seed(name, 'a', { ...record(), ...Object.fromEntries(fields.map(field => [field, 'server-value'])) });
        await assertSucceeds(deleteDoc(ref(a, name)));
    });
}

for (const name of ['invoices', 'payments']) {
    test(`${name}: current manual form payload and merge update succeed`, async () => {
        const values = name === 'invoices'
            ? { invoiceNumber: 'INV-001', customerName: 'Customer', customerId: 'customer-a', issueDate: '2026-09-07', dueDate: '2026-09-14', amount: 100, status: 'pending', service: 'Consultation' }
            : { paymentNumber: 'PAY-001', customerName: 'Customer', customerId: 'customer-a', invoiceNumber: 'INV-001', date: '2026-09-07', method: 'Cash', amount: 100, status: 'received' };
        await assertSucceeds(setDoc(ref(a, name), { ...values, ownerId: 'user-a', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true }));
        await assertSucceeds(setDoc(ref(a, name), { ...values, amount: 200, updatedAt: serverTimestamp() }, { merge: true }));
    });
}
