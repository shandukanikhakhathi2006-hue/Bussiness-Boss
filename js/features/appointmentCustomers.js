import { AppointmentValidationError } from './appointmentContract.js';

const text = value => String(value || '').trim();

// Customer IDs, rather than labels, are the association authority. Labels are
// only a current snapshot for people using the form.
export const appointmentCustomerOptions = (customers, selectedId = '', legacyName = '') => {
    const duplicateNames = new Set(customers.map(customer => text(customer.name)).filter(name => name && customers.filter(customer => text(customer.name) === name).length > 1));
    const options = [{ value: '', label: legacyName ? `Legacy customer: ${legacyName} — choose a customer to change it` : 'Choose a customer' }];
    for (const customer of customers) {
        const name = text(customer.name) || 'Unnamed customer';
        const suffix = duplicateNames.has(name) && text(customer.email) ? ` (${text(customer.email)})` : '';
        options.push({ value: customer.id, label: `${name}${suffix}` });
    }
    // Do not manufacture a replacement option for a deleted ID.
    return options;
};

export const selectedAppointmentCustomer = (customers, customerId) =>
    customers.find(customer => customer.id === customerId) || null;

export const prepareAppointmentCustomer = ({ customers, values, existing = {}, isEditing = false }) => {
    const customerId = text(values.customerId);
    if (!customerId) {
        if (isEditing && !text(existing.customerId) && text(existing.customerName)) {
            return { ...values, customerId: '', customerName: text(existing.customerName) };
        }
        throw new AppointmentValidationError('customerId');
    }
    const customer = selectedAppointmentCustomer(customers, customerId);
    if (!customer) throw new AppointmentValidationError('customerId');
    return { ...values, customerId: customer.id, customerName: text(customer.name) };
};
