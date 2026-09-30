const EDITABLE_FIELDS = ['customerName', 'customerId', 'date', 'time', 'service', 'staff', 'status'];
const STATUS_VALUES = new Set(['pending', 'completed', 'cancelled']);

export class AppointmentValidationError extends Error {
    constructor(path) {
        super('Invalid appointment input.');
        this.name = 'AppointmentValidationError';
        this.code = 'INVALID_APPOINTMENT';
        this.path = path;
    }
}

const fail = path => { throw new AppointmentValidationError(path); };

const readInput = (input) => {
    if (input === null || typeof input !== 'object'
        || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('input');
    const result = Object.create(null);
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== 'string' || !EDITABLE_FIELDS.includes(key)) fail(String(key));
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(key);
        result[key] = descriptor.value;
    }
    return result;
};

const hasControls = value => /[\u0000-\u001f\u007f-\u009f]/u.test(value);

const requiredText = (value, path, limit) => {
    if (typeof value !== 'string' || hasControls(value)) fail(path);
    const normalized = value.trim();
    if (!normalized || Array.from(normalized).length > limit) fail(path);
    return normalized;
};

const optionalText = (value, path, limit) => {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || hasControls(value)) fail(path);
    const normalized = value.trim();
    if (Array.from(normalized).length > limit) fail(path);
    return normalized;
};

const calendarDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail('date');
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail('date');
    return value;
};

const clockTime = value => {
    if (typeof value !== 'string' || !/^\d{2}:\d{2}$/u.test(value)) fail('time');
    const hour = Number(value.slice(0, 2));
    const minute = Number(value.slice(3, 5));
    if (hour > 23 || minute > 59) fail('time');
    return value;
};

/**
 * Strictly validates and normalizes the complete editable appointment content.
 * Its fresh return value is also the safe full-replacement update projection.
 * It intentionally owns no identity, timestamps, persistence, or completion time.
 */
export const normalizeAppointmentInput = input => {
    const source = readInput(input);
    const status = Object.hasOwn(source, 'status') ? source.status : 'pending';
    if (!STATUS_VALUES.has(status)) fail('status');
    return {
        customerName: requiredText(source.customerName, 'customerName', 200),
        customerId: optionalText(source.customerId, 'customerId', 128),
        date: calendarDate(source.date),
        time: clockTime(source.time),
        service: optionalText(source.service, 'service', 200),
        staff: optionalText(source.staff, 'staff', 200),
        status
    };
};
