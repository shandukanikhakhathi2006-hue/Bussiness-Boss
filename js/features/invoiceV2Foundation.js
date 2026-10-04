const root = document.querySelector('[data-v2-editor]');
const message = root.querySelector('[data-v2-status]');
export let editorState = null;
let binding;
try {
    const { clientEnvironment } = await import('../firebase/config.js');
    const { requireAuthenticatedUser } = await import('../firebase/auth.js');
    const { resolveInvoiceBusinessContext } = await import('../firebase/businessContextClient.js');
    const { createInvoiceDraftWorkflow } = await import('./invoiceDraftWorkflow.js');
    const { mountInvoiceDraftEditor } = await import('./invoiceDraftEditor.js');
    const api = await import('./invoiceDraftClient.js');
    requireAuthenticatedUser(user => {
        editorState?.dispose(); binding?.destroy();
        let businessId;
        try {
            ({ businessId } = await resolveInvoiceBusinessContext(clientEnvironment, user));
        } catch (error) {
            const unauthenticated = String(error?.code || '').replace(/^functions\//, '') === 'unauthenticated';
            root.querySelector('[data-session]').textContent = unauthenticated ? 'Sign in again' : 'Business unavailable';
            message.textContent = unauthenticated ? 'Sign in again to use Invoice v2.' : 'Business unavailable. Please try again.';
            return;
        }
        root.querySelector('[data-v2-business]').textContent = businessId;
        root.querySelector('[data-v2-environment]').textContent = clientEnvironment.local ? 'Local development' : 'Business';
        root.querySelector('[data-session]').textContent = clientEnvironment.local ? 'Signed in · Local development' : 'Signed in';
        editorState = createInvoiceDraftWorkflow({ environment: clientEnvironment, businessId, api,
            onChange(state, replace) {
                binding?.render(state, replace);
                if (!state.busy && state.status === 'ready' && state.mode === 'existing') {
                    const url = new URL(window.location.href); url.searchParams.set('id', state.invoiceId);
                    window.history.replaceState({}, '', url);
                }
                if (!state.busy && state.status === 'idle' && state.mode === 'new') {
                    const url = new URL(window.location.href); url.searchParams.delete('id');
                    window.history.replaceState({}, '', url);
                }
            } });
        binding = mountInvoiceDraftEditor(root, editorState);
        const ids = new URLSearchParams(window.location.search).getAll('id');
        if (ids.length) void editorState.load(ids.length === 1 ? ids[0] : '');
        else editorState.newDraft();
    });
    window.addEventListener('beforeunload', event => {
        const state = editorState?.snapshot();
        if (state?.dirty || state?.busy) { event.preventDefault(); event.returnValue = ''; }
    });
} catch {
    message.textContent = 'Unable to initialize Invoice v2. Sign in again and retry.';
}
