import { getFirstRecordDate } from '../utils/dates.js';

const isOutstandingInvoice = (invoice) => {
    const status = String(invoice.status || '').trim().toLowerCase();
    return status === 'pending' || status === 'overdue';
};

const compareDates = (first, second, fields, direction) => {
    const firstDate = getFirstRecordDate(first, fields);
    const secondDate = getFirstRecordDate(second, fields);
    if (!firstDate && !secondDate) return 0;
    if (!firstDate) return 1;
    if (!secondDate) return -1;
    return direction * (firstDate - secondDate);
};

export const dashboardInvoicesNeedingFollowUp = (records) => records
    .filter(isOutstandingInvoice)
    .sort((first, second) => {
        const firstOverdue = String(first.status || '').trim().toLowerCase() === 'overdue';
        const secondOverdue = String(second.status || '').trim().toLowerCase() === 'overdue';
        if (firstOverdue !== secondOverdue) return firstOverdue ? -1 : 1;
        return compareDates(first, second, ['dueDate', 'issueDate', 'date', 'createdAt'], 1);
    });

export const dashboardInvoiceRecords = (records) => {
    const followUpRecords = dashboardInvoicesNeedingFollowUp(records);
    if (followUpRecords.length) return followUpRecords;

    return [...records].sort((first, second) =>
        compareDates(first, second, ['issueDate', 'date', 'createdAt'], -1));
};
