export class CustomerCommandError extends Error {
    constructor(code, message = code) {
        super(message);
        this.name = 'CustomerCommandError';
        this.code = code;
    }
}

const fail = (code, message) => { throw new CustomerCommandError(code, message); };
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = value => typeof value === 'string' ? value.trim() : null;
const noControls = value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value);

export const isCustomerId = value => typeof value === 'string' && value.length > 0 && value.length <= 128
    && value.trim() === value && !value.includes('/') && !['.', '..'].includes(value)
    && !/^__.*__$/.test(value) && noControls(value);

const optional = (source, field, maximum) => {
    if (!Object.hasOwn(source, field)) return null;
    const value = source[field];
    if (value === undefined || value === null || value === '') return null;
    const normalized = text(value);
    if (!normalized || normalized.length > maximum || !noControls(normalized)) fail('INVALID_CUSTOMER', `Invalid ${field}.`);
    return normalized;
};

export function validateCustomerInput(input) {
    if (!plainObject(input)) fail('INVALID_CUSTOMER', 'Customer input must be an object.');
    const keys = Object.keys(input);
    if (keys.some(key => !['name', 'email', 'phone'].includes(key))) fail('INVALID_CUSTOMER', 'Customer input contains an unsupported field.');
    if (!Object.hasOwn(input, 'name')) fail('INVALID_CUSTOMER', 'Customer name is required.');
    const name = text(input.name);
    if (!name || name.length > 200 || !noControls(name)) fail('INVALID_CUSTOMER', 'Customer name is required.');
    const email = optional(input, 'email', 320);
    if (email !== null && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 320)) {
        fail('INVALID_CUSTOMER', 'Invalid email.');
    }
    return Object.freeze({ name, email, phone: optional(input, 'phone', 64) });
}

export function projectCustomer(customerId, stored) {
    if (!isCustomerId(customerId) || !plainObject(stored) || !['active', 'archived'].includes(stored.status)) {
        fail('INTERNAL', 'Stored customer is invalid.');
    }
    const input = validateCustomerInput({ name: stored.name, email: stored.email, phone: stored.phone });
    return Object.freeze({ customerId, ...input, status: stored.status });
}

// This projection is deliberately server-only. Its values originate from a
// tenant-scoped customer document, never from invoice request data.
export function customerSnapshotForInvoice(customerId, stored) {
    const customer = projectCustomer(customerId, stored);
    if (customer.status !== 'active') fail('CUSTOMER_ARCHIVED', 'Archived customers cannot be used for new invoices.');
    return Object.freeze({
        customerId: customer.customerId,
        customerNameSnapshot: customer.name,
        customerEmailSnapshot: customer.email,
        customerPhoneSnapshot: customer.phone
    });
}
