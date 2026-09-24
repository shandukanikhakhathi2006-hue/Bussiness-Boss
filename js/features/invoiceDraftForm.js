// Decimal text -> integer cents/basis points, without floating point scaling.
export function decimalToMinor(value) {
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value) || value.length > 19) {
        throw new Error('Enter a non-negative decimal with at most two decimal places.');
    }
    const [whole, fraction = ''] = value.split('.');
    const scaled = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Value is too large.');
    return Number(scaled);
}

export function minorToDecimal(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid minor units.');
    const minor = BigInt(value);
    return `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;
}

export function rand(value) {
    const [whole, fraction] = minorToDecimal(value).split('.');
    return `R ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

export const emptyDraft = () => ({ customerId: null, customerName: '', customerEmail: null,
    customerAddress: null, currency: 'ZAR', issueDate: null, dueDate: null, lineItems: [] });

export const newLine = id => ({ id, description: '', quantity: '1', unitPrice: '0.00', discount: '0.00', taxCode: 'ZERO', taxPercent: '0.00' });

export function draftToForm(draft) {
    return { customerName: draft.customerName, customerEmail: draft.customerEmail ?? '', customerAddress: draft.customerAddress ?? '',
        issueDate: draft.issueDate ?? '', dueDate: draft.dueDate ?? '', lineItems: draft.lineItems.map(line => ({
            id: line.id, description: line.description, quantity: line.quantity,
            unitPrice: minorToDecimal(line.unitPriceMinor), discount: minorToDecimal(line.discountMinor),
            taxCode: line.taxCode, taxPercent: minorToDecimal(line.taxRateBps)
        })) };
}

export function formToDraft(form) {
    const decimal = (value, path) => {
        try { return decimalToMinor(value); }
        catch { throw Object.assign(new Error('Check the decimal amount.'), { code: 'INVALID_REQUEST', details: { code: 'INVALID_REQUEST', path } }); }
    };
    return { customerId: null, customerName: form.customerName, customerEmail: form.customerEmail || null,
        customerAddress: form.customerAddress || null, currency: 'ZAR', issueDate: form.issueDate || null, dueDate: form.dueDate || null,
        lineItems: form.lineItems.map((line, index) => ({
            id: line.id, description: line.description, quantity: line.quantity,
            unitPriceMinor: decimal(line.unitPrice, `lineItems[${index}].unitPriceMinor`),
            discountMinor: decimal(line.discount, `lineItems[${index}].discountMinor`),
            taxRateBps: decimal(line.taxPercent, `lineItems[${index}].taxRateBps`), taxCode: line.taxCode, catalogItemId: null
        })) };
}
