const cleanText = (value) => typeof value === 'string' ? value.trim() : '';

export const literalTextValue = (value) => value == null || value === '' ? 'Not recorded' : String(value);

const toMilliseconds = (value) => {
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
};

export const normalizeMessageCustomer = (record = {}) => ({
    id: cleanText(record.id),
    name: cleanText(record.name) || 'Customer',
    email: cleanText(record.email),
    phone: cleanText(record.phone),
    status: cleanText(record.status)
});

export const normalizeCommunicationNote = (record = {}) => ({
    id: cleanText(record.id),
    customerId: cleanText(record.customerId) || null,
    customerName: cleanText(record.customerName),
    body: cleanText(record.body) || cleanText(record.text),
    createdAt: record.createdAt || null,
    source: cleanText(record.source)
});

const sortChronologically = (left, right) => {
    const difference = toMilliseconds(left.createdAt) - toMilliseconds(right.createdAt);
    return difference || left.id.localeCompare(right.id);
};

const latestNote = (conversation) => conversation.notes.at(-1) || null;

const conversationActivity = (conversation) => toMilliseconds(latestNote(conversation)?.createdAt);

const compareConversations = (left, right) => {
    const activityDifference = conversationActivity(right) - conversationActivity(left);
    if (activityDifference) return activityDifference;
    return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
};

const makeCustomerConversation = (customer) => ({
    id: 'customer:' + customer.id,
    kind: 'customer',
    customerId: customer.id,
    customer,
    snapshotName: '',
    notes: [],
    title: customer.name
});

const makeUnlinkedConversation = (id, kind, note) => ({
    id,
    kind,
    customerId: null,
    missingCustomerId: note.customerId,
    customer: null,
    snapshotName: note.customerName,
    notes: [],
    title: 'Customer unavailable'
});

export const buildMessageConversations = (customerRecords = [], noteRecords = []) => {
    const conversations = [];
    const byCustomerId = new Map();

    customerRecords
        .map(normalizeMessageCustomer)
        .filter((customer) => customer.id)
        .forEach((customer) => {
            const conversation = makeCustomerConversation(customer);
            conversations.push(conversation);
            byCustomerId.set(customer.id, conversation);
        });

    const unresolved = new Map();
    noteRecords
        .map(normalizeCommunicationNote)
        .filter((note) => note.id)
        .forEach((note) => {
            const linkedConversation = note.customerId ? byCustomerId.get(note.customerId) : null;
            if (linkedConversation) {
                linkedConversation.notes.push(note);
                return;
            }

            const key = note.customerId ? 'missing:' + note.customerId : 'legacy:' + note.id;
            let conversation = unresolved.get(key);
            if (!conversation) {
                conversation = makeUnlinkedConversation(key, note.customerId ? 'missing-customer' : 'legacy-name-only', note);
                unresolved.set(key, conversation);
                conversations.push(conversation);
            }
            conversation.notes.push(note);
        });

    conversations.forEach((conversation) => conversation.notes.sort(sortChronologically));
    return conversations.sort(compareConversations);
};

export const filterMessageConversations = (conversations = [], rawQuery = '') => {
    const query = cleanText(rawQuery).toLocaleLowerCase();
    if (!query) return conversations;

    return conversations.filter((conversation) => {
        const customer = conversation.customer;
        const searchable = customer
            ? [customer.name, customer.email, customer.phone]
            : [conversation.snapshotName, conversation.missingCustomerId];
        return searchable.some((value) => cleanText(value).toLocaleLowerCase().includes(query));
    });
};

export const conversationPreview = (conversation) => {
    const latest = latestNote(conversation);
    return latest?.body || (conversation.customer ? 'No local notes recorded.' : 'Unlinked saved note.');
};

export const conversationTimestamp = (conversation) => latestNote(conversation)?.createdAt || null;

export const getConversationById = (conversations = [], id) =>
    conversations.find((conversation) => conversation.id === id) || null;

export const isLinkedCustomerConversation = (conversation) =>
    Boolean(conversation?.kind === 'customer' && conversation.customerId);