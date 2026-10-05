import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../dashboard.css', import.meta.url), 'utf8');
const publicStyles = fs.readFileSync(new URL('../public.css', import.meta.url), 'utf8');
const authStyles = fs.readFileSync(new URL('../auth.css', import.meta.url), 'utf8');
const indexStyles = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const marketingStyles = fs.readFileSync(new URL('../marketing.css', import.meta.url), 'utf8');
const invoiceV2Styles = fs.readFileSync(new URL('../invoice-v2.css', import.meta.url), 'utf8');
const activeStyles = [dashboard, publicStyles, authStyles, indexStyles, marketingStyles, invoiceV2Styles];

test('authenticated shell and bounded wide-data components have shrink contracts', () => {
    assert.match(dashboard, /\.main-content\s*\{[\s\S]*?min-width:\s*0;/);
    assert.match(dashboard, /\.page-shell\s*\{[\s\S]*?width:\s*100%;/);
    assert.match(dashboard, /\.table-container\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?overflow-x:\s*auto;/);
    assert.match(dashboard, /\.modal-card\s*\{[\s\S]*?min-width:\s*0;/);
    assert.match(dashboard, /\.app-modal\s*\{[\s\S]*?min-width:\s*0;/);
});

test('responsive shell, report, Messages, and Settings grids can shrink at narrow widths', () => {
    assert.match(dashboard, /\.messages-workspace,[\s\S]*?\.settings-content\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/);
    assert.match(dashboard, /\.report-chart-shell,[\s\S]*?\.app-modal-fields\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/);
    assert.match(dashboard, /@media \(max-width: 700px\) \{[\s\S]*?\.toolbar-search,[\s\S]*?\.toolbar-select\s*\{[\s\S]*?width:\s*100%;/);
    assert.match(dashboard, /@media \(max-width: 768px\) \{[\s\S]*?\.messages-workspace\s*\{[\s\S]*?display:\s*block;/);
    assert.match(dashboard, /@media \(max-width: 700px\) \{[\s\S]*?\.settings-workspace\s*\{[\s\S]*?display:\s*block;/);
});

test('all active page styles have a safe box model and no ordinary 100vw content rule', () => {
    assert.match(dashboard, /\*\s*\{[\s\S]*?box-sizing:\s*border-box;/);
    assert.match(publicStyles, /\*,\s*\*::before,\s*\*::after\s*\{[\s\S]*?box-sizing:\s*border-box;/);
    assert.match(authStyles, /\*\{box-sizing:border-box\}/);
    for (const styles of activeStyles) {
        assert.doesNotMatch(styles, /width:\s*100vw\s*;/);
    }
});

