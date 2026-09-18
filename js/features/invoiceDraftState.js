const draftFields = ['customerId', 'customerName', 'customerEmail', 'customerAddress', 'currency', 'issueDate', 'dueDate', 'lineItems'];
const lineFields = ['id', 'description', 'quantity', 'unitPriceMinor', 'discountMinor', 'taxRateBps', 'taxCode', 'catalogItemId'];
const totalFields = ['subtotalMinor', 'discountMinor', 'taxMinor', 'totalMinor'];
const statuses = ['idle', 'loading', 'ready', 'saving', 'conflict', 'error'];
const pick = (source, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));

// Explicit projection, shared with the API adapter. Validation/calculation is
// still the server's job; this helper never calculates or inserts defaults.
export function editableDraft(source) {
    if (!source || typeof source !== 'object' || !Array.isArray(source.lineItems)) throw new Error('Invalid draft data.');
    const draft = pick(source, draftFields);
    draft.lineItems = source.lineItems.map(line => pick(line, lineFields));
    return structuredClone(draft);
}

const requireRevision = revision => {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid server revision.');
};

// In-memory state survives DOM rerenders, not reloads. No localStorage draft
// cache, network workflow, automatic merge or revision inference.
export function createInvoiceDraftState({ businessId, invoiceId = null }) {
    let state = { businessId, invoiceId, lifecycleStatus: null, revision: null, draft: null, totals: null, status: 'idle' };
    return Object.freeze({
        snapshot: () => structuredClone(state),
        setStatus(status) {
            if (!statuses.includes(status)) throw new Error('Invalid editor status.');
            state = { ...state, status };
        },
        adoptLoaded(response) {
            requireRevision(response.revision);
            if (!response.invoiceId || (state.invoiceId && response.invoiceId !== state.invoiceId)
                || response.lifecycleStatus !== 'draft' || !response.totals) throw new Error('Invalid server draft.');
            state = { ...state, invoiceId: response.invoiceId, lifecycleStatus: response.lifecycleStatus,
                revision: response.revision, draft: editableDraft(response.draft),
                totals: structuredClone(pick(response.totals, totalFields)), status: 'ready' };
        },
        adoptUpdated(response) {
            requireRevision(response.revision);
            if (state.revision === null || response.invoiceId !== state.invoiceId || response.revision <= state.revision) {
                throw new Error('Invalid server update result.');
            }
            // Update returns no totals. Invalidate the loaded totals rather than
            // presenting an old snapshot as the newly saved authoritative total.
            state = { ...state, revision: response.revision, totals: null, status: 'ready' };
        }
    });
}
