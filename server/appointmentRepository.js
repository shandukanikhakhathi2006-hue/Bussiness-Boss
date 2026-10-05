import { AppointmentCommandError, appointmentForInvoice, assertAppointmentTransition, isAppointmentId, projectAppointment, validateAppointmentInput } from '../js/backend/appointmentCommand.js';
import { businessIdValid } from './invoiceDraftBoundary.js';
import { BusinessContextError, resolveTrustedBusinessContext } from './businessContextRepository.js';
import { CustomerRepositoryError, loadActiveCustomerSnapshot } from './customerRepository.js';

export class AppointmentRepositoryError extends Error { constructor(code) { super(code); this.name = 'AppointmentRepositoryError'; this.code = code; } }
const fail = code => { throw new AppointmentRepositoryError(code); };
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = value => JSON.parse(JSON.stringify(value));
const assertUid = uid => { if (typeof uid !== 'string' || !uid || uid.includes('/')) fail('UNAUTHENTICATED'); };
const assertBusiness = id => { if (!businessIdValid(id)) fail('INVALID_REQUEST'); };
const assertAppointment = id => { if (!isAppointmentId(id)) fail('INVALID_REQUEST'); };
const appointmentRef = (db, businessId, appointmentId) => db.collection('businesses').doc(businessId).collection('appointments').doc(appointmentId);
const safeInput = (input, options) => { try { return validateAppointmentInput(input, options); } catch (error) { if (error instanceof AppointmentCommandError) fail(error.code); throw error; } };
const safeProjection = (id, stored, businessId) => {
    if (businessId !== undefined && (!plainObject(stored) || stored.businessId !== businessId)) fail('INTERNAL');
    try { return projectAppointment(id, stored); } catch (error) { if (error instanceof AppointmentCommandError) fail(error.code); throw error; }
};
const envelope = (data, fields) => {
    if (!plainObject(data) || Object.keys(data).length !== fields.length || !fields.every(field => Object.hasOwn(data, field))) fail('INVALID_REQUEST');
    assertBusiness(data.businessId); return clone(data);
};
export const validateCreateAppointmentRequest = data => { const request = envelope(data, ['businessId', 'input']); request.input = safeInput(request.input); return Object.freeze(request); };
export const validateUpdateAppointmentRequest = data => { const request = envelope(data, ['businessId', 'appointmentId', 'input']); assertAppointment(request.appointmentId); request.input = safeInput(request.input, { allowStatus: true }); return Object.freeze(request); };
export const validateAppointmentRouteRequest = data => { const request = envelope(data, ['businessId', 'appointmentId']); assertAppointment(request.appointmentId); return Object.freeze(request); };
export const validateListAppointmentsRequest = data => Object.freeze(envelope(data, ['businessId']));
const context = (transaction, db, uid, businessId) => resolveTrustedBusinessContext(transaction, db, uid, businessId);
const stored = ({ businessId, input, customer, uid, FieldValue }) => ({
    schemaVersion: 2, businessId, customerId: customer.customerId, customerNameSnapshot: customer.customerNameSnapshot,
    date: input.date, time: input.time, service: input.service, staff: input.staff, status: 'pending', invoiceId: null,
    createdBy: uid, updatedBy: uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
});

export async function createAppointment({ db, FieldValue, verifiedUid, data, makeAppointmentRef } = {}) {
    assertUid(verifiedUid); const request = validateCreateAppointmentRequest(data);
    if (!db?.runTransaction || !FieldValue?.serverTimestamp) fail('INTERNAL');
    const target = makeAppointmentRef ? makeAppointmentRef(db, request.businessId) : db.collection('businesses').doc(request.businessId).collection('appointments').doc();
    assertAppointment(target?.id);
    return db.runTransaction(async transaction => {
        await context(transaction, db, verifiedUid, request.businessId);
        const customer = await loadActiveCustomerSnapshot({ transaction, db, businessId: request.businessId, customerId: request.input.customerId });
        if ((await transaction.get(target)).exists) fail('APPOINTMENT_ALREADY_EXISTS');
        const record = stored({ businessId: request.businessId, input: request.input, customer, uid: verifiedUid, FieldValue });
        transaction.create(target, record); return safeProjection(target.id, record);
    });
}
export async function getAppointment({ db, verifiedUid, data } = {}) {
    assertUid(verifiedUid); const request = validateAppointmentRouteRequest(data);
    return db.runTransaction(async transaction => {
        await context(transaction, db, verifiedUid, request.businessId);
        const record = await transaction.get(appointmentRef(db, request.businessId, request.appointmentId));
        if (!record.exists) fail('APPOINTMENT_NOT_FOUND'); return safeProjection(request.appointmentId, record.data(), request.businessId);
    });
}
export async function listAppointments({ db, verifiedUid, data } = {}) {
    assertUid(verifiedUid); const request = validateListAppointmentsRequest(data);
    return db.runTransaction(async transaction => {
        await context(transaction, db, verifiedUid, request.businessId);
        const result = await transaction.get(db.collection('businesses').doc(request.businessId).collection('appointments'));
        return Object.freeze(result.docs.map(doc => safeProjection(doc.id, doc.data(), request.businessId)).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.appointmentId.localeCompare(b.appointmentId)));
    });
}
export async function updateAppointment({ db, FieldValue, verifiedUid, data } = {}) {
    assertUid(verifiedUid); const request = validateUpdateAppointmentRequest(data);
    return db.runTransaction(async transaction => {
        await context(transaction, db, verifiedUid, request.businessId);
        const target = appointmentRef(db, request.businessId, request.appointmentId); const record = await transaction.get(target);
        if (!record.exists) fail('APPOINTMENT_NOT_FOUND'); const prior = safeProjection(request.appointmentId, record.data(), request.businessId);
        if (prior.invoiceId !== null) fail('APPOINTMENT_INVOICED');
        try { assertAppointmentTransition(prior.status, request.input.status); } catch (error) { if (error instanceof AppointmentCommandError) fail(error.code); throw error; }
        const customer = request.input.customerId === prior.customerId
            ? { customerId: prior.customerId, customerNameSnapshot: prior.customerNameSnapshot }
            : await loadActiveCustomerSnapshot({ transaction, db, businessId: request.businessId, customerId: request.input.customerId });
        const update = { customerId: customer.customerId, customerNameSnapshot: customer.customerNameSnapshot, date: request.input.date, time: request.input.time, service: request.input.service, staff: request.input.staff, status: request.input.status, updatedBy: verifiedUid, updatedAt: FieldValue.serverTimestamp() };
        transaction.update(target, update); return Object.freeze({ appointmentId: request.appointmentId, ...request.input, customerNameSnapshot: customer.customerNameSnapshot, invoiceId: null });
    });
}
export async function loadAppointmentForInvoice({ transaction, db, businessId, appointmentId } = {}) {
    assertBusiness(businessId); assertAppointment(appointmentId);
    const record = await transaction.get(appointmentRef(db, businessId, appointmentId));
    if (!record.exists) fail('APPOINTMENT_NOT_FOUND');
    const stored = record.data();
    if (!plainObject(stored) || stored.businessId !== businessId) fail('INTERNAL');
    try { return appointmentForInvoice(appointmentId, stored); } catch (error) { if (error instanceof AppointmentCommandError) fail(error.code); throw error; }
}
export const appointmentRepositoryErrorCode = error => error instanceof AppointmentRepositoryError || error instanceof BusinessContextError || error instanceof CustomerRepositoryError ? error.code : 'INTERNAL';
