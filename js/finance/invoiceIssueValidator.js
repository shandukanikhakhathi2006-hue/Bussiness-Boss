import { validateInvoiceDraft } from './invoiceDraftValidator.js';

export class InvoiceIssueValidationError extends Error {
    constructor(code, message, path) {
        super(message);
        this.name = 'InvoiceIssueValidationError';
        this.code = code;
        this.path = path;
    }
}

/**
 * Checks business-input readiness only; does not issue or persist an invoice.
 * Accepts raw draft inputs, not the calculated preview returned by Stage 8B.
 * Draft errors propagate unchanged, including their arithmetic cause.
 * Authorization, seller/tax configuration and numbering belong to a backend.
 */
export const validateInvoiceForIssue = (input) => {
    const draft = validateInvoiceDraft(input);
    if (!draft.customerName) {
        throw new InvoiceIssueValidationError('CUSTOMER_NAME_REQUIRED', 'A customer snapshot name is required for issuance.', 'customerName');
    }
    if (draft.issueDate === null) {
        throw new InvoiceIssueValidationError('ISSUE_DATE_REQUIRED', 'An issue date is required for issuance.', 'issueDate');
    }
    if (draft.dueDate === null) {
        throw new InvoiceIssueValidationError('DUE_DATE_REQUIRED', 'A due date is required for issuance.', 'dueDate');
    }
    if (draft.lineItems.length === 0) {
        throw new InvoiceIssueValidationError('LINE_ITEMS_REQUIRED', 'At least one line is required for issuance.', 'lineItems');
    }
    if (draft.totals.totalMinor <= 0) {
        throw new InvoiceIssueValidationError('POSITIVE_TOTAL_REQUIRED', 'The invoice total must be positive for issuance.', 'totals.totalMinor');
    }
    // A normalized preview only: no status, identity or audit fields are added.
    return draft;
};
