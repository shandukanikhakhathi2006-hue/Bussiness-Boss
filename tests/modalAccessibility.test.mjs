import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const navigationSource = fs.readFileSync(new URL('../navigation.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../dashboard.css', import.meta.url), 'utf8');
const recordTableSource = fs.readFileSync(new URL('../js/utils/recordTable.js', import.meta.url), 'utf8');
const sidebarPages = ['dashboard.html', 'appointments.html', 'customers.html', 'expenses.html', 'invoices.html', 'payments.html', 'messages.html', 'reports.html', 'settings.html', 'help.html'];
const pageSource = page => fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');

test('form dialog has an accessible name and optional description', () => {
    assert.match(source, /heading\.id = nextAppModalId\('title'\);/);
    assert.match(source, /modal\.setAttribute\('aria-labelledby', heading\.id\);/);
    assert.match(source, /if \(description\) \{[\s\S]*modal\.setAttribute\('aria-describedby', descriptionElement\.id\);/);
});

test('form validation and save failures use an atomic live alert', () => {
    assert.match(source, /errorMessage\.setAttribute\('role', 'alert'\);/);
    assert.match(source, /errorMessage\.setAttribute\('aria-atomic', 'true'\);/);
    assert.match(source, /errorMessage\.classList\.add\('visible'\);/);
});

test('record dialogs expose required fields and associate validation errors', () => {
    assert.match(source, /input\.required = Boolean\(field\.required\);/);
    assert.match(source, /input\.setAttribute\('aria-invalid', 'true'\);/);
    assert.match(source, /input\.setAttribute\('aria-describedby', errorMessage\.id\);/);
});

test('record tables derive mobile labels and render truthful empty states', () => {
    assert.match(recordTableSource, /querySelectorAll\('thead th'\)/);
    assert.match(recordTableSource, /cell\.dataset\.label = labels\[index\]/);
    assert.match(recordTableSource, /colspan="\$\{columnCount\}"/);
    assert.match(recordTableSource, /state === 'error' \? 'alert' : 'status'/);
    assert.match(source, /No matching records\. Adjust your search or filters\./);
    assert.match(source, /actionLabel: 'Clear filters'/);
});

test('record tables use a responsive card layout and fitting modal controls', () => {
    assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.table-container tbody \{\s*display: grid;/);
    assert.match(styles, /td\[data-label\]::before\s*\{\s*content: attr\(data-label\);/);
    assert.match(styles, /\.app-modal-actions > button \{\s*min-height: 44px;/);
    assert.match(styles, /\.workspace-refined \{\s*min-width: 0;/);
});

test('generic record pages keep only live pagination and one customer clear action', () => {
    for (const page of ['customers.html', 'expenses.html', 'invoices.html', 'payments.html']) {
        const markup = pageSource(page);
        assert.match(markup, /<div class="pagination" hidden><\/div>/, `${page} should leave pagination to the shared renderer`);
        assert.doesNotMatch(markup, /<div class="pagination">[\s\S]*?<button[^>]*>\s*[123]/);
        assert.match(markup, /data-record-result-count/);
    }
    const customers = pageSource('customers.html');
    assert.equal((customers.match(/data-clear-filters/g) || []).length, 1);
});

test('confirmation dialog is labelled and described', () => {
    const confirmation = source.slice(source.indexOf('const showUpgradeConfirmModal'));
    assert.match(confirmation, /modal\.setAttribute\('aria-labelledby', heading\.id\);/);
    assert.match(confirmation, /modal\.setAttribute\('aria-describedby', body\.id\);/);
});

test('confirmation dialog traps Tab and Shift+Tab', () => {
    const confirmation = source.slice(source.indexOf('const showUpgradeConfirmModal'));
    assert.match(confirmation, /event\.key !== 'Tab'/);
    assert.match(confirmation, /event\.shiftKey && document\.activeElement === first/);
    assert.match(confirmation, /document\.activeElement === last/);
});

test('modal focus enters a dialog and safely restores to its opener', () => {
    assert.match(source, /\(inputs\[fields\[0\]\?\.name\] \|\| cancelButton\)\.focus\(\);/);
    assert.match(source, /confirmButton\.focus\(\);/);
    assert.match(source, /element instanceof HTMLElement && element\.isConnected && !element\.disabled/);
    assert.match(source, /restoreModalFocus\(previouslyFocused\);/);
});

test('shared async failures replace loading states with an accessible retry action', () => {
    assert.match(source, /const renderAsyncFailure/);
    assert.match(source, /role="alert"/);
    assert.match(source, /data-async-retry/);
    assert.match(source, /\(\) => loadPageRecords\(user\)/);
    assert.match(source, /\(\) => updateDashboardData\(user\)/);
});

test('message reads retry and sending is protected while pending', () => {
    assert.match(source, /Messages could not be loaded/);
    assert.match(source, /\(\) => loadMessages\(user\)/);
    assert.match(source, /let sending = false/);
    assert.match(source, /if \(sending\) return/);
    assert.match(source, /sendButton\.disabled = true/);
    assert.match(source, /finally \{ sending = false; if \(sendButton\) sendButton\.disabled = false; \}/);
});

test('mobile navigation has a dismissible backdrop and Escape handler', () => {
    assert.match(navigationSource, /sidebar-backdrop/);
    assert.match(navigationSource, /backdrop\.addEventListener\('click', closeMobileSidebar\)/);
    assert.match(navigationSource, /event\.key === 'Escape'/);
    assert.match(navigationSource, /sidebar\.classList\.remove\('open'\)/);
});

test('sidebar menu click has one shared owner and no page-local remnants', () => {
    assert.equal([...navigationSource.matchAll(/menuButton\.addEventListener\('click'/g)].length, 1);
    for (const page of sidebarPages) {
        const markup = pageSource(page);
        assert.doesNotMatch(markup, /menuButton\.addEventListener/);
        assert.match(markup, /<script src="navigation\.js"><\/script>/);
        assert.doesNotMatch(markup, /\bvoid\s+0\s*;/);
        assert.equal((markup.match(/<script\b[^>]*>/gi) || []).length, (markup.match(/<\/script>/gi) || []).length, `${page} should have balanced script tags`);
        assert.match(markup, /<\/body>\s*<\/html>\s*$/i, `${page} should close its document`);
    }
});

test('desktop collapse keeps an onscreen 72px rail and shifts main content', () => {
    assert.match(styles, /@media \(min-width: 701px\)[\s\S]*?body\.sidebar-collapsed \.sidebar\s*\{[^}]*width:\s*72px;[^}]*transform:\s*none;/);
    assert.match(styles, /body\.sidebar-collapsed \.main-content\s*\{\s*margin-left:\s*72px;/);
    assert.match(styles, /body\.sidebar-collapsed \.nav-link span/);
    assert.match(styles, /body\.sidebar-collapsed \.nav-title[\s\S]*?display:\s*none;/);
    assert.match(styles, /body\.sidebar-collapsed \.menu-button\s*\{\s*display:\s*none;/);
});

test('each sidebar has one native BusinessBoss restore button with the existing logo', () => {
    for (const page of sidebarPages) {
        const markup = pageSource(page);
        const buttons = [...markup.matchAll(/<button\b[^>]*class="sidebar-expand-button"[^>]*>[\s\S]*?<\/button>/g)];
        assert.equal(buttons.length, 1, `${page} should have one restore button`);
        assert.match(buttons[0][0], /type="button"/);
        assert.match(buttons[0][0], /aria-label="Expand navigation"/);
        assert.match(buttons[0][0], /images\/BussinessBoss-logo-2\.jpeg\.jpeg/);
        assert.doesNotMatch(buttons[0][0].slice(buttons[0][0].indexOf('>') + 1), /<button\b/);
    }
});

test('desktop and mobile accessible names follow the active mode', () => {
    assert.match(navigationSource, /mobileOpen \? 'Close navigation' : 'Open navigation'/);
    assert.match(navigationSource, /desktopExpanded \? 'Collapse navigation' : 'Expand navigation'/);
    assert.match(navigationSource, /expandButton\?\.addEventListener\('click'/);
    assert.match(navigationSource, /mobileViewport\.addEventListener\('change'/);
});

test('phone sidebar width is 180px with comfortable navigation targets', () => {
    assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.sidebar\s*\{\s*width:\s*min\(180px, calc\(100vw - 32px\)\);/);
    assert.match(styles, /\.nav-link\s*\{\s*min-height:\s*44px;/);
});

test('all authenticated page profile triggers remain native buttons', () => {
    for (const page of sidebarPages) {
        const markup = pageSource(page);
        assert.match(markup, /<button\b[^>]*id="profileMenuButton"/);
        assert.doesNotMatch(markup, /<div\b[^>]*id="profileMenuButton"/);
        const trigger = markup.match(/<button\b[^>]*id="profileMenuButton"[^>]*>[\s\S]*?<\/button>/)?.[0];
        assert.ok(trigger, `${page} should have a profile trigger`);
        const triggerContent = trigger.replace(/^<button\b[^>]*>/i, '').replace(/<\/button>$/i, '');
        assert.doesNotMatch(triggerContent, /<(?:button|input|select|textarea|label)\b/i, `${page} profile trigger must not nest interactive controls`);
        assert.match(markup, /id="profilePhotoUploadButton"/);
    }
});
