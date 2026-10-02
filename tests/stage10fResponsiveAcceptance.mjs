import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const base = 'http://127.0.0.1:4173';
const out = path.join(os.tmpdir(), 'businessboss-stage10f');
await fs.mkdir(out, { recursive: true });
console.log(`Screenshots: ${out}`);
const b = await chromium.launch({ headless: true });
const r = [];

async function exerciseDesktopSidebar(page) {
 const sidebar = page.locator('#sidebar'), collapse = page.locator('#menuButton');
 if (await collapse.count() !== 1 || !await collapse.isVisible() || !await collapse.isEnabled()) throw new Error('Desktop sidebar collapse control is missing, hidden, or disabled.');
 const collapseName = await collapse.getAttribute('aria-label');
 if (!/collapse navigation/i.test(collapseName || '')) throw new Error('Desktop sidebar collapse control must have accessible name "Collapse navigation".');
 const expanded = await sidebar.boundingBox();
 if (!expanded) throw new Error('Desktop sidebar is not visible before collapse.');
 if (Math.abs(expanded.width - 206) > 2) throw new Error(`Desktop expanded sidebar must be 206px wide; received ${expanded.width}px.`);
 const collapseAndReadRail = async () => {
   await collapse.click();
   await page.waitForFunction(() => {
     const sidebar = document.querySelector('#sidebar'), main = document.querySelector('.main-content');
     const rect = sidebar?.getBoundingClientRect();
     return document.body.classList.contains('sidebar-collapsed') && rect && Math.abs(rect.width - 72) <= 2 && rect.right > 0
       && main && Math.abs(parseFloat(getComputedStyle(main).marginLeft) - 72) <= 2;
   });
   const rail = await sidebar.boundingBox();
   if (!rail || Math.abs(rail.width - 72) > 2 || rail.right <= 0) throw new Error('Desktop sidebar did not remain visible as a 72px collapsed rail.');
   return rail;
 };
 const restoreAndAssert = async () => {
   const restore = page.getByRole('button', { name: 'Expand navigation' });
   if (await restore.count() !== 1 || !await restore.isVisible() || !await restore.isEnabled()) throw new Error('Desktop collapsed sidebar has no BusinessBoss Expand navigation button.');
   const tagName = await restore.evaluate(element => element.tagName);
   if (tagName !== 'BUTTON') throw new Error('Desktop BusinessBoss restore control must be a BUTTON.');
   const accessibleName = await restore.getAttribute('aria-label');
   if (accessibleName !== 'Expand navigation') throw new Error('Desktop BusinessBoss restore control must have accessible name "Expand navigation".');
   await restore.click();
   await page.waitForFunction(width => {
     const sidebar = document.querySelector('#sidebar'), main = document.querySelector('.main-content');
     return !document.body.classList.contains('sidebar-collapsed')
       && Math.abs((sidebar?.getBoundingClientRect().width || 0) - width) <= 2
       && main && Math.abs(parseFloat(getComputedStyle(main).marginLeft) - width) <= 2;
   }, expanded.width);
   const restoredLabels = await page.evaluate(() => getComputedStyle(document.querySelector('.brand-name')).display !== 'none'
     && [...document.querySelectorAll('.nav-link span')].every(label => getComputedStyle(label).display !== 'none'));
   if (!restoredLabels) throw new Error('Desktop navigation labels did not return after restoring the sidebar.');
   return { tagName, accessibleName };
 };
 const collapsed = await collapseAndReadRail();
 const restored = await restoreAndAssert();
 await collapseAndReadRail();
 await restoreAndAssert();
 return { expandedWidth: expanded.width, collapsedWidth: collapsed.width, collapseWorked: true, restoreButtonTag: restored.tagName, restoreAccessibleName: restored.accessibleName, restored: true, secondCycle: true };
}

for (const [n, v] of Object.entries({ desktop: { width: 1440, height: 900 }, tablet: { width: 768, height: 1024 }, phone: { width: 390, height: 844 } })) {
 const p = await b.newPage({ viewport: v }); const e = []; p.on('console', m => m.type() === 'error' && e.push(m.text()));
 await p.goto(base + '/login.html?emulator=1'); await p.getByLabel('Email address').fill('stage9nb-browser@example.test'); await p.getByLabel('Password').fill('local-browser-test'); await p.getByRole('button', { name: /log in/i }).click(); await p.waitForTimeout(500);
 const desktopSidebar = n === 'desktop' ? await exerciseDesktopSidebar(p) : undefined;
 await p.screenshot({ path: path.join(out, `${n}-dashboard.png`), fullPage: true }); const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
 await p.goto(base + '/appointments.html?emulator=1'); await p.waitForTimeout(500); await p.screenshot({ path: path.join(out, `${n}-appointments.png`), fullPage: true });
 const x = { n, overflow, e, actions: await p.locator('[data-page-action]').count(), profile: await p.locator('#profileMenuButton').evaluate(a => { if (a.tagName !== 'BUTTON') throw new Error('Profile trigger must be a native BUTTON.'); return a.tagName; }), desktopSidebar };
 if (n === 'phone') { const sidebarState = label => p.evaluate(label => { const sidebar = document.querySelector('.sidebar'), backdrop = document.querySelector('.sidebar-backdrop'); const describe = element => { const style = getComputedStyle(element), rect = element.getBoundingClientRect(); return { className: element.className, transform: style.transform, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right }, opacity: style.opacity, pointerEvents: style.pointerEvents }; }; const buttons = [...document.querySelectorAll('button[aria-label="Open navigation"]')]; return { label, sidebar: describe(sidebar), backdrop: describe(backdrop), matchingOpenNavigationControls: { count: buttons.length, elements: buttons.map(button => ({ tagName: button.tagName, id: button.id, className: button.className, insideSidebar: Boolean(button.closest('.sidebar')) })) } }; }, label); const phoneWidth = await p.locator('#sidebar').evaluate(sidebar => sidebar.getBoundingClientRect().width); if (Math.abs(phoneWidth - 180) > 2) throw new Error(`Phone sidebar must be 180px wide; received ${phoneWidth}px.`); const expandButton = p.locator('.sidebar-expand-button'); if (await expandButton.isVisible()) throw new Error('Desktop expand control must not be visible on mobile.'); const openNavigation = p.getByRole('button', { name: 'Open navigation' }); console.log('STAGE10F_SIDEBAR_STATE ' + JSON.stringify({ clicked: await openNavigation.evaluate(button => ({ tagName: button.tagName, id: button.id, className: button.className, insideSidebar: Boolean(button.closest('.sidebar')) })), before: await sidebarState('before click') })); await openNavigation.click(); console.log('STAGE10F_SIDEBAR_STATE ' + JSON.stringify({ immediate: await sidebarState('immediately after click') })); const closeLabel = await p.locator('#menuButton').getAttribute('aria-label'); if (closeLabel !== 'Close navigation') throw new Error(`Open phone navigation must be named "Close navigation"; received "${closeLabel}".`); const openWidth = await p.locator('#sidebar').evaluate(sidebar => sidebar.getBoundingClientRect().width); if (Math.abs(openWidth - 180) > 2) throw new Error(`Open phone sidebar must remain 180px wide; received ${openWidth}px.`); await p.waitForTimeout(250); await p.screenshot({ path: path.join(out, 'phone-sidebar-open.png') }); const backdrop = p.locator('.sidebar-backdrop'); x.backdrop = await backdrop.evaluate(a => getComputedStyle(a).pointerEvents === 'auto'); const hitTest = await p.evaluate(() => {
   const describe = element => { if (!element) return null; const style = getComputedStyle(element), rect = element.getBoundingClientRect(); return { tagName: element.tagName, id: element.id, className: String(element.className || ''), position: style.position, zIndex: style.zIndex, pointerEvents: style.pointerEvents, opacity: style.opacity, transform: style.transform, isolation: style.isolation, contain: style.contain, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left } }; };
   const sidebar = document.querySelector('.sidebar'), overlay = document.querySelector('.sidebar-backdrop'), main = document.querySelector('.main-content'), h2 = document.querySelector('.main-content .stat-card h2'); const sideRect = sidebar.getBoundingClientRect(); const x = Math.max(sideRect.right + 20, Math.round(innerWidth * .75)), y = Math.round(innerHeight * .5); return { point: { x, y }, elements: document.elementsFromPoint(x, y).slice(0, 10).map(describe), elementFromPoint: describe(document.elementFromPoint(x, y)), targets: { backdrop: describe(overlay), sidebar: describe(sidebar), mainContent: describe(main), interceptingH2: describe(h2) } };
 }); const clickPosition = { x: hitTest.point.x - hitTest.targets.backdrop.rect.left, y: hitTest.point.y - hitTest.targets.backdrop.rect.top }; x.backdropClickPoint = clickPosition; console.log('STAGE10F_BACKDROP_HIT_TEST ' + JSON.stringify({ ...hitTest, clickPosition })); try { await backdrop.click({ position: clickPosition }); } catch (error) { console.error('STAGE10F_BACKDROP_CLICK_FAILED ' + JSON.stringify({ ...hitTest, clickPosition })); throw error; } x.closed = await p.locator('#sidebar').evaluate(a => !a.classList.contains('open')); await p.getByRole('button', { name: /open navigation/i }).click(); await p.keyboard.press('Escape'); x.escape = await p.locator('#sidebar').evaluate(a => !a.classList.contains('open')); await p.getByRole('button', { name: /calendar view/i }).click(); await p.screenshot({ path: path.join(out, 'phone-calendar.png'), fullPage: true }); }
 r.push(x); await p.close();
}
await b.close(); console.log(JSON.stringify(r));
