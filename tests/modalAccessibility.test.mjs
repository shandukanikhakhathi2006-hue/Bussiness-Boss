import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');

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
