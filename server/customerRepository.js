import { CustomerCommandError, customerSnapshotForInvoice, isCustomerId, projectCustomer, validateCustomerInput } from '../js/backend/customerCommand.js';
import { businessIdValid } from './invoiceDraftBoundary.js';
import { BusinessContextError, resolveTrustedBusinessContext } from './businessContextRepository.js';

export class CustomerRepositoryError extends Error {
    constructor(code) { super(code); this.name = 'CustomerRepositoryError'; this.code = code; }
}

const fail = code => { throw new CustomerRepositoryError(code); };
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = value => JSON.parse(JSON.stringify(value));
const assertUid = uid => {
    if (typeof uid !== 'string' || !uid || uid.includes('/')) fail('UNAUTHENTICATED');
};
const assertBusinessId = businessId => {
    if (!businessIdValid(businessId)) fail('INVALID_REQUEST');
};
const assertCustomerId = customerId => {
    if (!isCustomerId(customerId)) fail('INVALID_REQUEST');
};
const customerRef = (db, businessId, customerId) => db.collection('businesses').doc(businessId).collection('customers').doc(customerId);
const safeInput = data => {
    try { return validateCustomerInput(data); }
    catch (error) { if (error instanceof CustomerCommandError) fail(error.code); throw error; }
};
const safeProjection = (id, data) => {
    try { return projectCustomer(id, data); }
    catch (error) { if (error instanceof CustomerCommandError) fail(error.code); throw error; }
};

function envelope(data, fields) {
    if (!plainObject(data) || Object.keys(data).length !== fields.length || !fields.every(field => Object.hasOwn(data, field))) fail('INVALID_REQUEST');
    assertBusinessId(data.businessId);
    return clone(data);
}

export const validateCreateCustomerRequest = data => {
    const request = envelope(data, ['businessId', 'input']);
    request.input = safeInput(request.input);
    return Object.freeze(request);
};
export const validateUpdateCustomerRequest = data => {
    const request = envelope(data, ['businessId', 'customerId', 'input']);
    assertCustomerId(request.customerId); request.input = safeInput(request.input);
    return Object.freeze(request);
};
export const validateCustomerRouteRequest = data => {
    const request = envelope(data, ['businessId', 'customerId']);
    assertCustomerId(request.customerId); return Object.freeze(request);
};
export const validateListCustomersRequest = data => Object.freeze(envelope(data, ['businessId']));

const contextFor = (transaction, db, uid, businessId) => {
    try { return resolveTrustedBusinessContext(transaction, db, uid, businessId); }
    catch (error) { throw error; }
};
const storedCustomer = ({ businessId, input, uid, FieldValue }) => ({
    schemaVersion: 2,
    businessId,
    status: 'active',
    name: input.name,
    email: input.email,
    phone: input.phone,
    createdBy: uid,
    updatedBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
});

export async function createCustomer({ db, FieldValue, verifiedUid, data, makeCustomerRef } = {}) {
    assertUid(verifiedUid); const request = validateCreateCustomerRequest(data);
    if (!db?.runTransaction || !FieldValue?.serverTimestamp) fail('INTERNAL');
    const target = makeCustomerRef ? makeCustomerRef(db, request.businessId) : db.collection('businesses').doc(request.businessId).collection('customers').doc();
    assertCustomerId(target?.id);
    return db.runTransaction(async transaction => {
        await contextFor(transaction, db, verifiedUid, request.businessId);
        if ((await transaction.get(target)).exists) fail('CUSTOMER_ALREADY_EXISTS');
        const stored = storedCustomer({ businessId: request.businessId, input: request.input, uid: verifiedUid, FieldValue });
        transaction.create(target, stored);
        return safeProjection(target.id, stored);
    });
}

export async function getCustomer({ db, verifiedUid, data } = {}) {
    assertUid(verifiedUid); const request = validateCustomerRouteRequest(data);
    return db.runTransaction(async transaction => {
        await contextFor(transaction, db, verifiedUid, request.businessId);
        const snapshot = await transaction.get(customerRef(db, request.businessId, request.customerId));
        if (!snapshot.exists) fail('CUSTOMER_NOT_FOUND');
        return safeProjection(request.customerId, snapshot.data());
    });
}

export async function listCustomers({ db, verifiedUid, data } = {}) {
    assertUid(verifiedUid); const request = validateListCustomersRequest(data);
    return db.runTransaction(async transaction => {
        await contextFor(transaction, db, verifiedUid, request.businessId);
        const snapshot = await transaction.get(db.collection('businesses').doc(request.businessId).collection('customers'));
        return Object.freeze(snapshot.docs.map(doc => safeProjection(doc.id, doc.data()))
            .filter(customer => customer.status === 'active').sort((left, right) => left.name.localeCompare(right.name) || left.customerId.localeCompare(right.customerId)));
    });
}

export async function updateCustomer({ db, FieldValue, verifiedUid, data } = {}) {
    assertUid(verifiedUid); const request = validateUpdateCustomerRequest(data);
    return db.runTransaction(async transaction => {
        await contextFor(transaction, db, verifiedUid, request.businessId);
        const target = customerRef(db, request.businessId, request.customerId);
        const snapshot = await transaction.get(target);
        if (!snapshot.exists) fail('CUSTOMER_NOT_FOUND');
        const prior = safeProjection(request.customerId, snapshot.data());
        if (prior.status !== 'active') fail('CUSTOMER_ARCHIVED');
        const update = { name: request.input.name, email: request.input.email, phone: request.input.phone,
            updatedBy: verifiedUid, updatedAt: FieldValue.serverTimestamp() };
        transaction.update(target, update);
        return Object.freeze({ customerId: request.customerId, ...request.input, status: 'active' });
    });
}

export async function archiveCustomer({ db, FieldValue, verifiedUid, data } = {}) {
    assertUid(verifiedUid); const request = validateCustomerRouteRequest(data);
    return db.runTransaction(async transaction => {
        await contextFor(transaction, db, verifiedUid, request.businessId);
        const target = customerRef(db, request.businessId, request.customerId);
        const snapshot = await transaction.get(target);
        if (!snapshot.exists) fail('CUSTOMER_NOT_FOUND');
        const customer = safeProjection(request.customerId, snapshot.data());
        if (customer.status === 'active') transaction.update(target, { status: 'archived', updatedBy: verifiedUid, updatedAt: FieldValue.serverTimestamp() });
        return Object.freeze({ ...customer, status: 'archived' });
    });
}

// Used by a future invoice command after it has already resolved authority in
// the same transaction. A foreign-tenant ID is therefore indistinguishable
// from a missing customer and cannot cross the tenant boundary.
export async function loadCustomerForInvoice({ transaction, db, businessId, customerId } = {}) {
    assertBusinessId(businessId); assertCustomerId(customerId);
    const snapshot = await transaction.get(customerRef(db, businessId, customerId));
    if (!snapshot.exists) fail('CUSTOMER_NOT_FOUND');
    try { return customerSnapshotForInvoice(customerId, snapshot.data()); }
    catch (error) { if (error instanceof CustomerCommandError) fail(error.code); throw error; }
}

export const customerRepositoryErrorCode = error => error instanceof CustomerRepositoryError || error instanceof BusinessContextError
    ? error.code : 'INTERNAL';
