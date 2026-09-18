// Import configuration dynamically so a disabled/invalid local entry can show a
// safe message without initializing Firebase or falling through to legacy code.
const message = document.querySelector('[data-v2-status]');
export let editorState = null;
try {
    const { clientEnvironment } = await import('../firebase/config.js');
    const { requireAuthenticatedUser } = await import('../firebase/auth.js');
    const { getLocalBusinessContext } = await import('../firebase/localBusinessContext.js');
    const { createInvoiceDraftState } = await import('./invoiceDraftState.js');
    // Load the shared API binding, but do not execute a command in this stage.
    await import('./invoiceDraftClient.js');
    requireAuthenticatedUser(user => {
        const context = getLocalBusinessContext(clientEnvironment, user);
        editorState = createInvoiceDraftState(context);
        message.textContent = 'Local foundation ready. The draft editor will be added in the next stage.';
        document.querySelector('[data-v2-business]').textContent = editorState.snapshot().businessId;
    });
} catch {
    message.textContent = 'Invoice v2 is available only in explicit local emulator mode. See the local development instructions.';
}
