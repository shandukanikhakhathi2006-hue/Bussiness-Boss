import { rand } from './invoiceDraftForm.js';

// DOM is a view of controlled form state, never a revision/authority store.
export function mountInvoiceDraftEditor(root, workflow, { confirm = message => window.confirm(message) } = {}) {
    const by = selector => root.querySelector(selector);
    const form = by('[data-draft-form]'), fields = by('[data-edit-fields]'), lines = by('[data-lines]');
    const message = by('[data-v2-status]'), totals = by('[data-totals]');
    const showFields = state => {
        for (const input of root.querySelectorAll('[data-customer-field]')) input.value = state.form?.[input.dataset.customerField] ?? '';
        lines.replaceChildren();
        for (const [index, line] of (state.form?.lineItems || []).entries()) {
            const row = document.createElement('fieldset'); row.className = 'v2-line'; row.dataset.lineId = line.id;
            const legend = document.createElement('legend'); legend.textContent = `Line ${index + 1}`; row.append(legend);
            const grid = document.createElement('div'); grid.className = 'v2-line-grid'; row.append(grid);
            for (const [key, label, path] of [
                ['description', 'Description', 'description'], ['quantity', 'Quantity', 'quantity'],
                ['unitPrice', 'Unit price (R)', 'unitPriceMinor'], ['discount', 'Discount (R)', 'discountMinor'],
                ['taxCode', 'Tax code', 'taxCode'], ['taxPercent', 'Tax rate (%)', 'taxRateBps']
            ]) {
                const wrapper = document.createElement('label'); wrapper.textContent = label;
                const input = document.createElement('input'); input.type = 'text'; input.value = line[key];
                input.dataset.lineField = key; input.dataset.path = `lineItems[${index}].${path}`;
                input.name = `${key}-${line.id}`; input.required = true;
                if (['quantity', 'unitPrice', 'discount', 'taxPercent'].includes(key)) input.inputMode = 'decimal';
                if (key === 'description') input.maxLength = 500;
                if (key === 'taxCode') input.maxLength = 64;
                wrapper.append(input); grid.append(wrapper);
            }
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary-button';
            remove.dataset.removeLine = line.id; remove.textContent = `Remove line ${index + 1}`; row.append(remove); lines.append(row);
        }
    };
    const render = (state, replace = false) => {
        if (replace) showFields(state);
        fields.disabled = !state.canEdit;
        by('[data-new]').disabled = state.busy;
        by('[data-load]').disabled = state.busy;
        by('[data-load-id]').disabled = state.busy;
        by('[data-save]').disabled = !state.canSave;
        by('[data-save]').textContent = state.busy && state.status === 'saving' ? 'Saving…' : state.mode === 'new' ? 'Create draft' : 'Save changes';
        by('[data-add]').disabled = !state.canEdit || state.form.lineItems.length >= 100;
        const reload = by('[data-reload]'); reload.hidden = !state.needsReload && !state.blocked; reload.disabled = state.busy;
        by('[data-invoice-id]').textContent = state.invoiceId || 'Not selected';
        by('[data-revision]').textContent = state.revision === null ? 'Not loaded' : String(state.revision);
        by('[data-state]').textContent = state.status === 'idle' ? 'New / not saved' : state.status;
        message.textContent = state.feedback.message;
        message.dataset.tone = ['conflict', 'error'].includes(state.status) ? 'error' : 'success';
        root.setAttribute('aria-busy', String(state.busy));
        for (const input of root.querySelectorAll('[data-path]')) input.setAttribute('aria-invalid', String(Boolean(state.feedback.path && input.dataset.path === state.feedback.path)));
        const displayed = state.dirty || state.mode === 'new' ? state.preview : state.totals;
        totals.replaceChildren();
        const title = document.createElement('p');
        title.textContent = state.dirty || state.mode === 'new' ? 'Local preview · confirmed by the server when saved' : 'Server totals'; totals.append(title);
        if (displayed) {
            for (const [key, label] of [['subtotalMinor', 'Subtotal'], ['discountMinor', 'Discount'], ['taxMinor', 'Tax'], ['totalMinor', 'Total']]) {
                const item = document.createElement('p'); item.textContent = `${label}: ${rand(displayed[key])}`; totals.append(item);
            }
        } else {
            const item = document.createElement('p'); item.textContent = 'Totals unavailable until valid values are entered or a server snapshot is loaded.'; totals.append(item);
        }
    };
    const input = event => {
        const target = event.target;
        if (target.dataset.customerField) workflow.edit(target.dataset.customerField, target.value);
        if (target.dataset.lineField) workflow.edit(target.dataset.lineField, target.value, target.closest('[data-line-id]').dataset.lineId);
    };
    const replaceAllowed = () => !workflow.snapshot().dirty || confirm('Replace your unsaved edits?');
    const click = event => {
        const button = event.target.closest('button');
        if (!button || button.disabled) return;
        if (button.hasAttribute('data-new') && replaceAllowed()) workflow.newDraft();
        if (button.hasAttribute('data-load') && replaceAllowed()) void workflow.load(by('[data-load-id]').value.trim());
        if (button.hasAttribute('data-add')) workflow.addLine();
        if (button.dataset.removeLine) workflow.removeLine(button.dataset.removeLine);
        if (button.hasAttribute('data-reload') && confirm('Reloading replaces your current unsaved edits with the latest server version. Continue?')) void workflow.reload(true);
    };
    const submit = event => { event.preventDefault(); void workflow.save(); };
    root.addEventListener('input', input); root.addEventListener('click', click); form.addEventListener('submit', submit);
    render(workflow.snapshot(), true);
    return { render, destroy() { root.removeEventListener('input', input); root.removeEventListener('click', click); form.removeEventListener('submit', submit); } };
}
