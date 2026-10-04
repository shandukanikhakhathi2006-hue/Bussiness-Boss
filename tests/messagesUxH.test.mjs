import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    buildMessageConversations,
    conversationPreview,
    filterMessageConversations,
    getConversationById,
    literalTextValue
} from '../js/features/messagesWorkspaceState.js';

const page = fs.readFileSync(new URL('../messages.html', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../js/features/messagesWorkspace.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../dashboard.css', import.meta.url), 'utf8');

const customer = (id, name, extra = {}) => ({
    id,
    name,
    email: extra.email || '',
    phone: extra.phone || '',
    status: extra.status || 'active'
});

const note = (id, body, extra = {}) => ({
    id,
    body,
    customerId: extra.customerId,
    customerName: extra.customerName,
    createdAt: extra.createdAt || id
});

test('Messages has a truthful communication-notes hierarchy with one page heading', () => {
    assert.equal((page.match(/<h1\b/g) || []).length, 1);
    assert.match(page, /<h1 class="page-title" id="messagesTitle">Messages<\/h1>/);
    assert.match(page, /Customer conversations/);
    assert.match(page, /Communication history/);
    assert.match(page, /Add a local communication note/);
    assert.match(page, /not delivered to customers/);
    assert.match(page, /data-messages-list/);
    assert.match(page, /data-messages-detail-content/);
    assert.match(page, /data-messages-composer/);
});

test('unsupported consumer-chat controls, demo content, localStorage, and inline page code are removed', () => {
    for (const unsupported of [
        /defaultConversations/,
        /businessBossMessagesState/,
        /localStorage/,
        /Call customer/,
        /Video call/,
        /aria-label="Attach file"/,
        /aria-label="Emoji"/,
        />Archive</,
        />New Message</,
        /Online<\//
    ]) {
        assert.doesNotMatch(page, unsupported);
    }
    assert.doesNotMatch(page, /<style>/);
    assert.doesNotMatch(page, /<script>\s*[\s\S]*?<\/script>/);
    assert.doesNotMatch(workspace, /localStorage/);
    assert.match(workspace, /source: 'local-note'/);
    assert.match(workspace, /customerId: conversation\.customerId/);
});

test('real customer IDs keep duplicate names distinct and notes remain linked by ID', () => {
    const conversations = buildMessageConversations(
        [
            customer('customer-a', 'Alex Smith', { email: 'alex.one@example.test' }),
            customer('customer-b', 'Alex Smith', { email: 'alex.two@example.test' })
        ],
        [
            note('note-a', 'First note', { customerId: 'customer-a', customerName: 'Alex Smith', createdAt: 2 }),
            note('note-b', 'Second note', { customerId: 'customer-b', customerName: 'Alex Smith', createdAt: 3 })
        ]
    );

    assert.equal(getConversationById(conversations, 'customer:customer-a').notes[0].body, 'First note');
    assert.equal(getConversationById(conversations, 'customer:customer-b').notes[0].body, 'Second note');
    assert.notEqual(
        getConversationById(conversations, 'customer:customer-a').customerId,
        getConversationById(conversations, 'customer:customer-b').customerId
    );
});

test('deleted and legacy name-only customer references never silently remap by name', () => {
    const conversations = buildMessageConversations(
        [customer('live-customer', 'Customer <Admin>')],
        [
            note('deleted-note', 'Saved before deletion', {
                customerId: 'deleted-customer',
                customerName: 'Customer <Admin>',
                createdAt: 2
            }),
            note('legacy-note', 'Older saved note', {
                customerName: 'Customer <Admin>',
                createdAt: 1
            })
        ]
    );

    const live = getConversationById(conversations, 'customer:live-customer');
    const deleted = getConversationById(conversations, 'missing:deleted-customer');
    const legacy = getConversationById(conversations, 'legacy:legacy-note');
    assert.equal(live.notes.length, 0);
    assert.equal(deleted.kind, 'missing-customer');
    assert.equal(deleted.customer, null);
    assert.equal(deleted.snapshotName, 'Customer <Admin>');
    assert.equal(legacy.kind, 'legacy-name-only');
    assert.equal(legacy.customer, null);
});

test('search uses available customer name, email, and phone fields and reports no matches safely', () => {
    const conversations = buildMessageConversations(
        [
            customer('one', 'Nomsa Dlamini', { email: 'nomsa@example.test', phone: '0710000001' }),
            customer('two', 'Theo Molefe', { email: 'theo@example.test', phone: '0710000002' })
        ],
        []
    );

    assert.deepEqual(filterMessageConversations(conversations, 'nomsa@example.test').map((item) => item.customerId), ['one']);
    assert.deepEqual(filterMessageConversations(conversations, '0000002').map((item) => item.customerId), ['two']);
    assert.equal(filterMessageConversations(conversations, 'no result').length, 0);
});

test('untrusted customer names and note content retain literal text instead of becoming markup', () => {
    const payloads = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        'Customer <Admin>',
        'Tom & Sons "PTY"'
    ];
    const conversations = buildMessageConversations(
        [customer('unsafe', payloads[2], { email: payloads[3] })],
        [note('unsafe-note', payloads[1], { customerId: 'unsafe', customerName: payloads[0], createdAt: 1 })]
    );

    const conversation = getConversationById(conversations, 'customer:unsafe');
    assert.equal(conversation.customer.name, payloads[2]);
    assert.equal(conversation.customer.email, payloads[3]);
    assert.equal(conversationPreview(conversation), payloads[1]);
    for (const payload of payloads) assert.equal(literalTextValue(payload), payload);
    assert.match(workspace, /element\.textContent = literalTextValue\(value\)/);
    assert.doesNotMatch(workspace, /\.innerHTML/);
});

test('Messages feature provides loading, empty, filtered-empty, error, and selected states with retry', () => {
    assert.match(workspace, /Loading customers and communication notes/);
    assert.match(workspace, /No customer conversations are available yet/);
    assert.match(workspace, /No customers match your search/);
    assert.match(workspace, /Messages could not be loaded/);
    assert.match(workspace, /retry\.addEventListener\('click', \(\) => load\(\)\)/);
    assert.match(workspace, /Select a customer to review local communication notes/);
    assert.match(workspace, /No local communication notes are recorded for this customer/);
});

test('Messages has a real mobile single-pane structure and wraps long values without page overflow', () => {
    assert.match(page, /data-mobile-pane="list"/);
    assert.match(page, /data-messages-back/);
    assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?data-mobile-pane="list"\] \.messages-detail-panel/);
    assert.match(styles, /data-mobile-pane="detail"\] \.messages-list-panel/);
    assert.match(styles, /@media \(max-width: 320px\)/);
    assert.match(styles, /\.messages-note-body,[\s\S]*?overflow-wrap:\s*anywhere/);
    assert.match(styles, /\.messages-page \{\s*min-width:\s*0;/);
});

test('Messages controls are semantic and keyboard reachable', () => {
    assert.match(page, /<label for="conversationSearch">Search customers<\/label>/);
    assert.match(page, /<nav aria-label="Customer conversations">/);
    assert.match(page, /<button class="messages-back-button" type="button" data-messages-back>/);
    assert.match(page, /<form class="messages-composer" data-messages-composer>/);
    assert.match(page, /role="status" aria-live="polite"/);
    assert.match(workspace, /button\.setAttribute\('aria-pressed', String\(isSelected\)\)/);
    assert.match(styles, /\.messages-conversation-button:focus-visible/);
});