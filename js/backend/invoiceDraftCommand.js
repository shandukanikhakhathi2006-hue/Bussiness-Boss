import { validateInvoiceDraft } from '../finance/invoiceDraftValidator.js';

export class InvoiceDraftCommandError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'InvoiceDraftCommandError';
        this.code = code;
    }
}

const fail = (code, message) => { throw new InvoiceDraftCommandError(code, message); };

// Read required own data fields only; never invoke context accessors. Additional
// trusted claims are allowed, but are neither authorization inputs nor output.
const readContext = (context, fields, code) => {
    if (context === null || typeof context !== 'object'
        || ![Object.prototype, null].includes(Object.getPrototypeOf(context))) {
        fail(code, 'Expected a plain trusted context.');
    }
    const result = {};
    for (const field of fields) {
        const descriptor = Object.getOwnPropertyDescriptor(context, field);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            fail(code, `Required context field ${field} must be an own data property.`);
        }
        result[field] = descriptor.value;
    }
    return result;
};

// Contract IDs are opaque, nonblank strings of at most 128 Unicode code points.
// Reject ambiguous surrounding whitespace and controls instead of rewriting IDs.
const validIdentity = value => typeof value === 'string' && value.length > 0
    && value.trim() === value && Array.from(value).length <= 128
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);

/**
 * Pure preparation, not an authenticated endpoint or a persistence command.
 * A future server adapter MUST obtain authContext from verified identity and
 * businessContext from a trusted lookup. Never pass client-supplied contexts.
 * This function cannot establish the provenance of the contexts it receives.
 *
 * Order: identity, business structure/IDs, ownership, role, Stage 8B draft.
 * businessId is one non-dot path segment; no business lookup is performed here.
 * No issuance requirements, lifecycle fields, timestamps, numbering or writes.
 */
export const authorizeAndPrepareInvoiceDraftCommand = ({ authContext, businessContext, input } = {}) => {
    if (authContext === null || authContext === undefined) {
        fail('UNAUTHENTICATED', 'Authenticated identity is required.');
    }
    const auth = readContext(authContext, ['uid'], 'INVALID_AUTH_CONTEXT');
    if (!validIdentity(auth.uid)) fail('INVALID_AUTH_CONTEXT', 'Invalid authenticated UID.');

    const business = readContext(businessContext, ['businessId', 'ownerId', 'role'], 'INVALID_BUSINESS_CONTEXT');
    if (!validIdentity(business.businessId) || business.businessId.includes('/')
        || business.businessId === '.' || business.businessId === '..'
        || !validIdentity(business.ownerId)) {
        fail('INVALID_BUSINESS_CONTEXT', 'Invalid business or owner identifier.');
    }
    if (auth.uid !== business.ownerId) {
        fail('BUSINESS_ACCESS_DENIED', 'Only the business owner may prepare a draft.');
    }
    if (business.role !== 'owner') {
        fail('INVALID_BUSINESS_ROLE', 'The owner role is required.');
    }

    // Stage 8B rejects unknown input fields and owns all normalization/math.
    // Its detailed errors (including arithmetic causes) propagate unchanged.
    const draft = validateInvoiceDraft(input);
    return { businessId: business.businessId, ownerId: business.ownerId, actorUid: auth.uid, draft };
};
