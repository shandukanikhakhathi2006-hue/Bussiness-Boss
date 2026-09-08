import { firestore } from '../firebase/config.js';
import { money } from '../utils/currency.js';
import { getFirstRecordDate } from '../utils/dates.js';
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const pageInstances = new WeakMap();

export const initInvoicesPage = ({ pageName, pageShell, tableBody, pageEscape, pageDateText, statusClass, generateNextReferenceId, updateFinancialStats }) => {
	if (pageName !== 'invoices') return null;
	if (pageInstances.has(pageShell)) return pageInstances.get(pageShell);

	const pageDate = (record) => getFirstRecordDate(record, ['date', 'createdAt', 'issueDate']);
	const renderRows = (records) => {
		if (!tableBody) return;
		if (!records.length) {
			tableBody.innerHTML = '<tr><td colspan="8">No invoices found yet.</td></tr>';
			return;
		}
		tableBody.innerHTML = records.map((record) => `<tr data-record-id="${record.id}"><td><strong>${pageEscape(record.invoiceNumber || record.id)}</strong></td><td>${pageEscape(record.customerName || 'Customer')}</td><td>${pageEscape(pageDateText({ date: record.issueDate || record.date }))}</td><td>${pageEscape(pageDateText({ date: record.dueDate }))}</td><td>${money(record.amount)}</td><td><span class="status-badge ${statusClass(record.status)}">${pageEscape(record.status || 'Pending')}</span></td><td><button class="view-button" type="button" data-page-action="edit">Edit</button> <button class="view-button" type="button" data-page-action="delete">Delete</button></td></tr>`).join('');
	};

	const matchesFilters = (record, selects) => selects.every((select) => {
		const value = select.value;
		if (!value || value === 'all') return true;
		if (select.id === 'invoiceStatusFilter') {
			return String(record.status || '').toLowerCase() === value;
		}
		if (select.id === 'invoiceTimeFilter') {
			const date = pageDate(record);
			if (!date) return false;
			const now = new Date();
			if (value === 'month') return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
			if (value === '90days') { const daysAgo = (now - date) / 86400000; return daysAgo >= 0 && daysAgo <= 90; }
			return true;
		}
		return true;
	});

	const saveRecord = async (user, values, recordId = null) => {
		// Manual bookkeeping fields only; verified-payment metadata is never sent.
		const record = {
			invoiceNumber: values.invoiceNumber, customerName: values.customerName,
			customerId: values.customerId, issueDate: values.issueDate, dueDate: values.dueDate,
			amount: Number(values.amount), status: values.status, service: values.service,
			updatedAt: serverTimestamp()
		};
		if (!recordId) {
			record.ownerId = user.uid;
			record.createdAt = serverTimestamp();
		}
		await setDoc(recordId ? doc(firestore, 'invoices', recordId) : doc(collection(firestore, 'invoices')), record, { merge: true });
	};

	const feature = {
		singularTitle: 'Invoice',
		fields: (customerHint, existing, generatedId) => [
			{ name: 'invoiceNumber', label: 'Invoice ID', disabled: true, defaultValue: existing.invoiceNumber || generatedId },
			{ name: 'customerName', label: 'Customer name', required: true, placeholder: customerHint },
			{ name: 'issueDate', label: 'Issue date', type: 'date' },
			{ name: 'dueDate', label: 'Due date', type: 'date' },
			{ name: 'amount', label: 'Invoice amount', type: 'number', required: true },
			{ name: 'status', label: 'Status', type: 'select', options: ['pending', 'paid', 'overdue'] },
			{ name: 'service', label: 'Service/category' }
		],
		getSnapshot: (user) => getDocs(query(collection(firestore, 'invoices'), where('ownerId', '==', user.uid))),
		saveRecord,
		deleteRecord: (recordId) => deleteDoc(doc(firestore, 'invoices', recordId)),
		generateNumber: (user) => generateNextReferenceId('invoices', 'invoiceNumber', 'INV', user),
		renderRows,
		updateStats: (records) => updateFinancialStats(records),
		matchesFilters,
		exportColumns: [['Invoice number', 'invoiceNumber'], ['Customer', 'customerName'], ['Issue date', 'issueDate'], ['Due date', 'dueDate'], ['Amount', 'amount'], ['Status', 'status']],
		isCreateButton: (button) => button.textContent.toLowerCase().includes('create invoice')
	};
	pageInstances.set(pageShell, feature);
	return feature;
};
