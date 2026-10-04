import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';
import { firestore } from '../firebase/config.js';
import { requireAuthenticatedUser } from '../firebase/auth.js';
import {
    buildMessageConversations,
    conversationPreview,
    conversationTimestamp,
    filterMessageConversations,
    getConversationById,
    isLinkedCustomerConversation
} from './messagesWorkspaceState.js';

const customerCollection = 'customers';
const notesCollection = 'messages';

const firstLetters = (value) => String(value || 'Customer')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

const asDate = (value) => {
    if (typeof value?.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === 'number' || typeof value === 'string') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
};

export const formatMessageTimestamp = (value) => {
    const date = asDate(value);
    if (!date) return 'Time not recorded';
    return new Intl.DateTimeFormat('en-ZA', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
};

// Every value originating from a Firestore record is rendered through textContent.
export const renderLiteralText = (element, value) => {
    element.textContent = literalTextValue(value);
};

const element = (tagName, className, value) => {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (value !== undefined) renderLiteralText(node, value);
    return node;
};

const loadWorkspaceRecords = async (user) => {
    const ownerQuery = (name) => query(collection(firestore, name), where('ownerId', '==', user.uid));
    const [customerSnapshot, noteSnapshot] = await Promise.all([
        getDocs(ownerQuery(customerCollection)),
        getDocs(ownerQuery(notesCollection))
    ]);
    return {
        customers: customerSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
        notes: noteSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    };
};

const saveLocalCommunicationNote = (user, conversation, body) => addDoc(collection(firestore, notesCollection), {
    ownerId: user.uid,
    customerId: conversation.customerId,
    customerName: conversation.customer.name,
    body,
    source: 'local-note',
    createdAt: serverTimestamp()
});

export const mountMessagesWorkspace = (root, {
    loadRecords = loadWorkspaceRecords,
    saveNote = saveLocalCommunicationNote
} = {}) => {
    const search = root.querySelector('[data-messages-search]');
    const list = root.querySelector('[data-messages-list]');
    const listStatus = root.querySelector('[data-messages-list-status]');
    const detailState = root.querySelector('[data-messages-detail-state]');
    const detailContent = root.querySelector('[data-messages-detail-content]');
    const customerName = root.querySelector('[data-messages-customer-name]');
    const customerDescription = root.querySelector('[data-messages-customer-description]');
    const customerAvatar = root.querySelector('[data-messages-avatar]');
    const customerEmail = root.querySelector('[data-messages-customer-email]');
    const customerPhone = root.querySelector('[data-messages-customer-phone]');
    const customerStatus = root.querySelector('[data-messages-customer-status]');
    const history = root.querySelector('[data-messages-history]');
    const composer = root.querySelector('[data-messages-composer]');
    const input = root.querySelector('[data-messages-input]');
    const submit = root.querySelector('[data-messages-submit]');
    const feedback = root.querySelector('[data-messages-feedback]');
    const unlinkedNote = root.querySelector('[data-messages-unlinked-note]');
    const back = root.querySelector('[data-messages-back]');

    let currentUser = null;
    let conversations = [];
    let selectedId = null;
    let isLoading = false;
    let isSaving = false;
    let loadFailed = false;

    const selectedConversation = () => getConversationById(conversations, selectedId);

    const setDetailState = (message, tone = 'status') => {
        detailContent.hidden = true;
        detailState.hidden = false;
        detailState.setAttribute('role', tone === 'error' ? 'alert' : 'status');
        renderLiteralText(detailState, message);
    };

    const renderHistory = (conversation) => {
        history.replaceChildren();
        if (!conversation.notes.length) {
            const empty = element('p', 'messages-empty-history', 'No local communication notes are recorded for this customer.');
            empty.setAttribute('role', 'status');
            history.append(empty);
            return;
        }

        conversation.notes.forEach((note) => {
            const record = element('article', 'messages-note-record');
            const header = element('div', 'messages-note-header');
            const source = element('strong', '', note.source === 'local-note' ? 'Business note' : 'Saved communication note');
            const timestamp = element('time', '', formatMessageTimestamp(note.createdAt));
            header.append(source, timestamp);

            const body = element('p', 'messages-note-body', note.body || 'No note content was recorded.');
            record.append(header, body);
            history.append(record);
        });
    };

    const renderDetail = () => {
        const conversation = selectedConversation();
        if (isLoading) {
            setDetailState('Loading customers and communication notes…');
            return;
        }
        if (loadFailed) {
            setDetailState('Messages could not be loaded. Retry from the conversation list.', 'error');
            return;
        }
        if (!conversation) {
            setDetailState('Select a customer to review local communication notes.');
            return;
        }

        detailState.hidden = true;
        detailContent.hidden = false;
        renderLiteralText(customerName, conversation.title);
        renderLiteralText(customerAvatar, firstLetters(conversation.customer?.name || conversation.snapshotName || 'Customer'));

        if (conversation.customer) {
            renderLiteralText(customerDescription, 'Internal notes for this customer. Notes are not delivered externally.');
            renderLiteralText(customerEmail, conversation.customer.email);
            renderLiteralText(customerPhone, conversation.customer.phone);
            renderLiteralText(customerStatus, conversation.customer.status || 'Not recorded');
        } else {
            renderLiteralText(
                customerDescription,
                conversation.snapshotName
                    ? 'This saved note is not linked to a current customer. Saved customer name: ' + conversation.snapshotName + '.'
                    : 'This saved note is not linked to a current customer record.'
            );
            renderLiteralText(customerEmail, 'Customer unavailable');
            renderLiteralText(customerPhone, 'Customer unavailable');
            renderLiteralText(customerStatus, 'Unlinked record');
        }

        renderHistory(conversation);
        const canCompose = isLinkedCustomerConversation(conversation);
        composer.hidden = !canCompose;
        unlinkedNote.hidden = canCompose;
        if (!canCompose) {
            renderLiteralText(
                unlinkedNote,
                'This saved record has no current customer ID. It has not been matched to another customer by name, and a new note cannot be added until a real customer is selected.'
            );
        }
    };

    const selectConversation = (id, { focusDetail = false } = {}) => {
        selectedId = id;
        renderList();
        renderDetail();
        if (focusDetail && window.matchMedia('(max-width: 768px)').matches) {
            root.dataset.mobilePane = 'detail';
            customerName.focus();
        }
    };

    const makeConversationButton = (conversation) => {
        const item = element('li', 'messages-conversation-item');
        const button = element('button', 'messages-conversation-button');
        const isSelected = conversation.id === selectedId;
        button.type = 'button';
        button.setAttribute('aria-pressed', String(isSelected));
        if (isSelected) button.classList.add('is-selected');

        const avatar = element('span', 'messages-avatar messages-list-avatar', firstLetters(conversation.customer?.name || conversation.snapshotName || 'Customer'));
        avatar.setAttribute('aria-hidden', 'true');

        const content = element('span', 'messages-conversation-content');
        const top = element('span', 'messages-conversation-topline');
        top.append(element('strong', '', conversation.title));
        const timestamp = conversationTimestamp(conversation);
        if (timestamp) top.append(element('time', '', formatMessageTimestamp(timestamp)));

        const preview = element('span', 'messages-conversation-preview', conversationPreview(conversation));
        content.append(top, preview);
        button.append(avatar, content);
        button.addEventListener('click', () => selectConversation(conversation.id, { focusDetail: true }));
        item.append(button);
        return item;
    };

    const addRetry = () => {
        const item = element('li', 'messages-list-retry');
        const retry = element('button', 'secondary-button', 'Retry');
        retry.type = 'button';
        retry.addEventListener('click', () => load());
        item.append(retry);
        list.append(item);
    };

    const renderList = () => {
        list.replaceChildren();
        const visible = filterMessageConversations(conversations, search.value);

        if (isLoading) {
            renderLiteralText(listStatus, 'Loading customers and communication notes…');
            return;
        }

        if (loadFailed) {
            listStatus.setAttribute('role', 'alert');
            renderLiteralText(listStatus, 'Messages could not be loaded.');
            addRetry();
            return;
        }

        listStatus.setAttribute('role', 'status');
        if (!conversations.length) {
            renderLiteralText(listStatus, 'No customer conversations are available yet. Add a customer to start recording local notes.');
            return;
        }
        if (!visible.length) {
            renderLiteralText(listStatus, 'No customers match your search.');
            return;
        }

        renderLiteralText(listStatus, visible.length + (visible.length === 1 ? ' customer conversation' : ' customer conversations'));
        visible.forEach((conversation) => list.append(makeConversationButton(conversation)));
    };

    const load = async () => {
        if (!currentUser) return;
        isLoading = true;
        loadFailed = false;
        renderList();
        renderDetail();
        try {
            const records = await loadRecords(currentUser);
            conversations = buildMessageConversations(records.customers, records.notes);
            if (selectedId && !selectedConversation()) selectedId = null;
        } catch (error) {
            console.error('Failed to load customer communication notes', error);
            conversations = [];
            selectedId = null;
            loadFailed = true;
        } finally {
            isLoading = false;
            renderList();
            renderDetail();
        }
    };

    search.addEventListener('input', () => renderList());

    back.addEventListener('click', () => {
        root.dataset.mobilePane = 'list';
        const selectedButton = list.querySelector('.messages-conversation-button.is-selected');
        selectedButton?.focus();
    });

    composer.addEventListener('submit', async (event) => {
        event.preventDefault();
        const conversation = selectedConversation();
        const body = input.value.trim();
        if (!conversation || !isLinkedCustomerConversation(conversation) || !body || isSaving) return;

        isSaving = true;
        submit.disabled = true;
        renderLiteralText(feedback, 'Saving local note…');
        try {
            await saveNote(currentUser, conversation, body);
            input.value = '';
            renderLiteralText(feedback, 'Local note saved. It was not delivered to the customer.');
            await load();
        } catch (error) {
            console.error('Failed to save local communication note', error);
            feedback.setAttribute('role', 'alert');
            renderLiteralText(feedback, 'The local note could not be saved. Please try again.');
        } finally {
            isSaving = false;
            submit.disabled = false;
        }
    });

    return {
        start: async (user) => {
            currentUser = user;
            await load();
        },
        reload: load,
        getState: () => ({ conversations, selectedId, isLoading, loadFailed })
    };
};

const root = document.querySelector('[data-messages-workspace]');
if (root) {
    const workspace = mountMessagesWorkspace(root);
    requireAuthenticatedUser((user) => workspace.start(user));
}