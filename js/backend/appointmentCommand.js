export class AppointmentCommandError extends Error {
    constructor(code, message = code) { super(message); this.name = 'AppointmentCommandError'; this.code = code; }
}

const fail = (code, message) => { throw new AppointmentCommandError(code, message); };
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const noControls = value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const statuses = new Set(['pending', 'completed', 'cancelled']);
export const isAppointmentId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value && !value.includes('/') && !['.', '..'].includes(value) && !/^__.*__$/.test(value) && noControls(value);
const text = (value, field, maximum) => {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') fail('INVALID_APPOINTMENT', `Invalid ${field}.`);
    const normalized = value.trim();
    if (normalized.length > maximum || !noControls(normalized)) fail('INVALID_APPOINTMENT', `Invalid ${field}.`);
    return normalized;
};
const date = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('INVALID_APPOINTMENT', 'Invalid appointment date.');
    const [year, month, day] = value.split('-').map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const max = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > max) fail('INVALID_APPOINTMENT', 'Invalid appointment date.');
    return value;
};
const time = value => {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('INVALID_APPOINTMENT', 'Invalid appointment time.');
    return value;
};
export function validateAppointmentInput(input, { allowStatus = false } = {}) {
    if (!plainObject(input)) fail('INVALID_APPOINTMENT', 'Appointment input must be an object.');
    const permitted = allowStatus ? ['customerId', 'date', 'time', 'service', 'staff', 'status'] : ['customerId', 'date', 'time', 'service', 'staff'];
    if (Object.keys(input).some(key => !permitted.includes(key)) || !Object.hasOwn(input, 'customerId') || typeof input.customerId !== 'string' || !isAppointmentId(input.customerId)) fail('INVALID_APPOINTMENT', 'A valid customer ID is required.');
    const result = { customerId: input.customerId, date: date(input.date), time: time(input.time), service: text(input.service, 'service', 200), staff: text(input.staff, 'staff', 160) };
    if (allowStatus) { if (!Object.hasOwn(input, 'status') || !statuses.has(input.status)) fail('INVALID_APPOINTMENT', 'Invalid appointment status.'); result.status = input.status; }
    return Object.freeze(result);
}
export function assertAppointmentTransition(previous, next) {
    if (!statuses.has(previous) || !statuses.has(next)) fail('INVALID_APPOINTMENT', 'Invalid appointment status.');
    if (previous === 'pending' || previous === next) return;
    fail('INVALID_APPOINTMENT_TRANSITION', 'Completed and cancelled appointments cannot return to another status.');
}
export function projectAppointment(appointmentId, stored) {
    if (!isAppointmentId(appointmentId) || !plainObject(stored) || !statuses.has(stored.status) || typeof stored.customerNameSnapshot !== 'string' || !stored.customerNameSnapshot) fail('INTERNAL', 'Stored appointment is invalid.');
    const input = validateAppointmentInput({ customerId: stored.customerId, date: stored.date, time: stored.time, service: stored.service, staff: stored.staff, status: stored.status }, { allowStatus: true });
    if (stored.invoiceId !== null && !isAppointmentId(stored.invoiceId)) fail('INTERNAL', 'Stored appointment is invalid.');
    return Object.freeze({ appointmentId, ...input, customerNameSnapshot: stored.customerNameSnapshot, invoiceId: stored.invoiceId });
}
export function appointmentForInvoice(appointmentId, stored) {
    const appointment = projectAppointment(appointmentId, stored);
    if (appointment.status !== 'completed') fail('APPOINTMENT_NOT_COMPLETED', 'Only completed appointments can be invoiced.');
    if (appointment.invoiceId !== null) fail('APPOINTMENT_ALREADY_INVOICED', 'Appointment already has an invoice.');
    return Object.freeze({ appointmentId: appointment.appointmentId, customerId: appointment.customerId, customerNameSnapshot: appointment.customerNameSnapshot, date: appointment.date, service: appointment.service });
}
