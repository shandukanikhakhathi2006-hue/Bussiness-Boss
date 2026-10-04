import { createInvoiceDraftState } from './invoiceDraftState.js';
import { draftToForm, formToDraft, emptyDraft, newLine } from './invoiceDraftForm.js';
import { calculateInvoiceTotals } from '../finance/invoiceCalculations.js';
import { DEMO_PROJECT_ID, PRODUCTION_PROJECT_ID } from '../firebase/clientEnvironment.js';

const messages = {
    UNAUTHENTICATED: 'Sign in again.',
    BUSINESS_ACCESS_DENIED: 'You do not have access to this business.',
    BUSINESS_NOT_FOUND: 'This business is unavailable.', BUSINESS_INACTIVE: 'This business is inactive.',
    INVALID_BUSINESS_ROLE: 'Only the business owner can edit drafts.',
    INVOICE_NOT_FOUND: 'The draft could not be found.', INVOICE_NOT_EDITABLE: 'This invoice is no longer an editable draft.',
    INVOICE_REVISION_CONFLICT: 'This invoice was changed elsewhere. Your edits have not been saved. Reload the latest version before saving again.',
    INVALID_REQUEST: 'Check the draft fields and invoice ID.', INVALID_INVOICE_DRAFT: 'Check the highlighted draft field.',
    REFERENCE_NOT_SUPPORTED: 'Linked customers and catalog items are not supported.',
    INVOICE_ALREADY_EXISTS: 'This draft ID already exists. Reload to inspect it, or deliberately start a new draft.',
    UNAVAILABLE: 'Unable to save invoice. Please try again.', INTERNAL: 'Unable to save invoice. Please try again.'
};
const transport = { unauthenticated: 'UNAUTHENTICATED', 'permission-denied': 'BUSINESS_ACCESS_DENIED', 'not-found': 'INVOICE_NOT_FOUND',
    'failed-precondition': 'INVOICE_NOT_EDITABLE', aborted: 'INVOICE_REVISION_CONFLICT', unavailable: 'UNAVAILABLE',
    'invalid-argument': 'INVALID_REQUEST', 'already-exists': 'INVOICE_ALREADY_EXISTS', internal: 'INTERNAL' };
const labels = { customerName: 'customer name', customerEmail: 'customer email', customerAddress: 'customer address', currency: 'currency',
    issueDate: 'issue date', dueDate: 'due date', lineItems: 'line items', description: 'description', quantity: 'quantity',
    unitPriceMinor: 'unit price', discountMinor: 'discount', taxRateBps: 'tax rate', taxCode: 'tax code', id: 'line ID' };
export function safeDraftError(error) {
    const detail = error?.details?.code;
    const code = Object.hasOwn(messages, detail) ? detail : transport[String(error?.code).replace(/^functions\//, '')] || 'INTERNAL';
    let path = null, field = '';
    if (['INVALID_REQUEST', 'INVALID_INVOICE_DRAFT'].includes(code)) {
        const candidate = error?.details?.path;
        if (typeof candidate === 'string' && Object.hasOwn(labels, candidate)) { path = candidate; field = labels[candidate]; }
        const match = typeof candidate === 'string' && /^lineItems\[(\d{1,2})\]\.(description|quantity|unitPriceMinor|discountMinor|taxRateBps|taxCode|id)$/.exec(candidate);
        if (match) { path = candidate; field = `line ${Number(match[1]) + 1} ${labels[match[2]]}`; }
    }
    return { code, path, message: field ? `Please check ${field}.` : messages[code] };
}
const routeValid = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) && !/^__.*__$/.test(id);
const localError = code => ({ details: { code } });

// Owns command coordination; SDK/DOM-free for deterministic race/error tests.
export function createInvoiceDraftWorkflow({ environment, businessId, api, makeId = () => crypto.randomUUID(), onChange = () => {} }) {
    const validEnvironment = environment.local
        ? environment.projectId === DEMO_PROJECT_ID
        : environment.projectId === PRODUCTION_PROJECT_ID;
    if (!validEnvironment) throw new Error('Invoice v2 environment is unavailable.');
    let state = createInvoiceDraftState({ businessId });
    let busy = false, blocked = false, needsReload = false, disposed = false, mode = 'new', pendingId = null;
    let feedback = { code: null, path: null, message: 'Start a new draft or load an existing draft.' };
    const view = () => {
        const snapshot = state.snapshot();
        let preview = null;
        if (snapshot.form) { try { preview = calculateInvoiceTotals(formToDraft(snapshot.form).lineItems); } catch { /* incomplete input */ } }
        return { ...snapshot, busy, blocked, needsReload, mode, feedback: { ...feedback }, preview,
            canEdit: !disposed && !busy && !blocked && Boolean(snapshot.form),
            canSave: !disposed && !busy && !blocked && !needsReload && Boolean(snapshot.form) };
    };
    const emit = (replace = false) => { if (!disposed) onChange(view(), replace); };
    const changed = form => {
        state.setForm(form);
        if (!needsReload) {
            state.setStatus(mode === 'new' ? 'idle' : 'ready');
            feedback = { message: 'Unsaved changes.' };
        }
    };
    const fail = (error, { read = false, uncertain = false } = {}) => {
        feedback = safeDraftError(error);
        needsReload ||= uncertain || ['INVOICE_REVISION_CONFLICT', 'INVOICE_ALREADY_EXISTS'].includes(feedback.code);
        blocked ||= read || ['UNAUTHENTICATED', 'BUSINESS_ACCESS_DENIED', 'BUSINESS_NOT_FOUND', 'BUSINESS_INACTIVE', 'INVALID_BUSINESS_ROLE', 'INVOICE_NOT_EDITABLE', 'INVOICE_NOT_FOUND'].includes(feedback.code);
        state.setStatus(feedback.code === 'INVOICE_REVISION_CONFLICT' ? 'conflict' : 'error');
    };
    const adopt = (loaded, id) => {
        if (loaded.invoiceId !== id) throw localError('INTERNAL');
        // Build a complete replacement first. Bad responses never partially
        // replace an existing draft or its raw unsaved form.
        const next = createInvoiceDraftState({ businessId, invoiceId: id });
        next.adoptLoaded(loaded);
        next.setForm(draftToForm(loaded.draft), false);
        state = next; mode = 'existing'; blocked = false; needsReload = false; pendingId = id;
    };
    const load = async id => {
        if (busy || disposed) return false;
        if (!routeValid(id)) { fail(localError('INVALID_REQUEST')); emit(); return false; }
        pendingId = id; busy = true; state.setStatus('loading'); feedback = { message: 'Loading draft…' }; emit();
        try {
            const loaded = await api.getInvoiceDraft({ businessId, invoiceId: id });
            if (disposed) return false;
            adopt(loaded, id); feedback = { message: 'Draft loaded.' }; return true;
        } catch (error) { if (!disposed) fail(error, { read: true }); return false; }
        finally { busy = false; emit(true); }
    };
    const workflow = {
        snapshot: view,
        dispose() { disposed = true; },
        newDraft() {
            if (busy || disposed) return false;
            const invoiceId = makeId();
            if (!routeValid(invoiceId)) throw new Error('Invalid generated invoice ID.');
            state = createInvoiceDraftState({ businessId, invoiceId });
            const form = draftToForm(emptyDraft()); form.lineItems.push(newLine(makeId())); state.setForm(form, false);
            mode = 'new'; blocked = false; needsReload = false; pendingId = null;
            feedback = { message: 'New draft. Changes are not saved yet.' }; emit(true); return true;
        },
        edit(field, value, lineId = null) {
            if (!view().canEdit) return false;
            const form = state.snapshot().form;
            const allowed = lineId === null ? ['customerName', 'customerEmail', 'customerAddress', 'issueDate', 'dueDate']
                : ['description', 'quantity', 'unitPrice', 'discount', 'taxCode', 'taxPercent'];
            if (!allowed.includes(field) || typeof value !== 'string') return false;
            const target = lineId === null ? form : form.lineItems.find(line => line.id === lineId);
            if (!target) return false;
            target[field] = value; changed(form); emit(); return true;
        },
        addLine() {
            if (!view().canEdit) return false;
            const form = state.snapshot().form;
            if (form.lineItems.length >= 100) return false;
            form.lineItems.push(newLine(makeId())); changed(form); emit(true); return true;
        },
        removeLine(id) {
            if (!view().canEdit) return false;
            const form = state.snapshot().form; form.lineItems = form.lineItems.filter(line => line.id !== id);
            changed(form); emit(true); return true;
        },
        load,
        reload(confirmed = false) {
            if (!confirmed || busy || disposed) return Promise.resolve(false);
            return load(pendingId || state.snapshot().invoiceId);
        },
        async save() {
            if (!view().canSave) return false;
            const current = state.snapshot();
            let input;
            try { input = formToDraft(current.form); }
            catch (error) { fail(error); emit(); return false; }
            busy = true; state.setStatus('saving'); feedback = { message: 'Saving draft…' }; emit();
            let committed = false, writing = true;
            try {
                let revision = null;
                if (mode === 'new') {
                    const result = await api.saveInvoiceDraft({ businessId, invoiceId: current.invoiceId, draft: input });
                    if (disposed) return false;
                    if (result.invoiceId !== current.invoiceId || result.lifecycleStatus !== 'draft') throw localError('INTERNAL');
                    committed = true;
                } else {
                    const result = await api.updateInvoiceDraft({ businessId, invoiceId: current.invoiceId, expectedRevision: current.revision, input });
                    if (disposed) return false;
                    state.adoptUpdated(result); state.setStatus('saving'); revision = result.revision; committed = true;
                }
                writing = false; pendingId = current.invoiceId;
                // Create never fabricates revision 1. Update adopts only the
                // server's committed revision, then requires an exact readback.
                const loaded = await api.getInvoiceDraft({ businessId, invoiceId: current.invoiceId });
                if (disposed) return false;
                if (revision !== null && loaded.revision !== revision) {
                    needsReload = true; state.setStatus('conflict');
                    feedback = { code: 'READBACK_MISMATCH', message: 'Your save completed, but the server version changed again. Your local content is preserved. Reload the latest version before continuing.' };
                    return false;
                }
                adopt(loaded, current.invoiceId); feedback = { message: 'Draft saved.' }; return true;
            } catch (error) {
                if (!disposed) {
                    const code = safeDraftError(error).code;
                    fail(error, { uncertain: committed || (writing && ['UNAVAILABLE', 'INTERNAL'].includes(code)) });
                    if (committed) feedback.message = `Your save completed, but refreshing failed. ${feedback.message} Reload the latest version before saving again.`;
                    else if (needsReload && ['UNAVAILABLE', 'INTERNAL'].includes(code)) feedback.message = 'The save result could not be confirmed. Your local content is preserved. Reload before trying again.';
                }
                return false;
            } finally { busy = false; emit(true); }
        }
    };
    return Object.freeze(workflow);
}
