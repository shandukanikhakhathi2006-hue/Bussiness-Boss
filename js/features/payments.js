import { firestore } from '../firebase/config.js';
import { money } from '../utils/currency.js';
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const pageInstances = new WeakMap();

export const initPaymentsPage = ({ pageName, pageShell, tableBody, pageEscape, pageDateText, statusClass, generateNextReferenceId, updateFinancialStats }) => {
	if (pageName !== 'payments') return null;
	if (pageInstances.has(pageShell)) return pageInstances.get(pageShell);

	const renderRows = (records) => {
		if (!tableBody) return;
		if (!records.length) {
			tableBody.innerHTML = '<tr><td colspan="8">No payments found yet.</td></tr>';
			return;
		}
		tableBody.innerHTML = records.map((record) => `<tr data-record-id="${record.id}"><td><strong>${pageEscape(record.paymentNumber || record.id)}</strong></td><td>${pageEscape(record.customerName || 'Customer')}</td><td>${pageEscape(record.invoiceNumber || record.invoiceId || 'Not linked')}</td><td>${pageEscape(pageDateText(record))}</td><td>${pageEscape(record.method || 'Not set')}</td><td>${money(record.amount)}</td><td><span class="status-badge ${statusClass(record.status)}">${pageEscape(record.status || 'Received')}</span></td><td><button class="view-button" type="button" data-page-action="edit">Edit</button> <button class="view-button" type="button" data-page-action="delete">Delete</button></td></tr>`).join('');
	};

	const saveRecord = async (user, values, recordId = null) => {
		// Manual bookkeeping only: provider metadata and invoice verification are separate.
		const record = {
			paymentNumber: values.paymentNumber, customerName: values.customerName,
			customerId: values.customerId, invoiceNumber: values.invoiceNumber, date: values.date,
			method: values.method, amount: Number(values.amount), status: values.status,
			updatedAt: serverTimestamp()
		};
		if (!recordId) {
			record.ownerId = user.uid;
			record.createdAt = serverTimestamp();
		}
		await setDoc(recordId ? doc(firestore, 'payments', recordId) : doc(collection(firestore, 'payments')), record, { merge: true });
	};

	const feature = {
		singularTitle: 'Payment',
		fields: (customerHint, existing, generatedId) => [
			{ name: 'paymentNumber', label: 'Payment ID', disabled: true, defaultValue: existing.paymentNumber || generatedId },
			{ name: 'customerName', label: 'Customer name', required: true, placeholder: customerHint },
			{ name: 'invoiceNumber', label: 'Invoice number' },
			{ name: 'date', label: 'Payment date', type: 'date' },
			{ name: 'method', label: 'Payment method', type: 'select', options: ['Cash', 'Bank'], required: true },
			{ name: 'amount', label: 'Amount', type: 'number', required: true },
			{ name: 'status', label: 'Status', type: 'select', options: ['received', 'pending', 'refunded'] }
		],
		getSnapshot: (user) => getDocs(query(collection(firestore, 'payments'), where('ownerId', '==', user.uid))),
		saveRecord,
		deleteRecord: (recordId) => deleteDoc(doc(firestore, 'payments', recordId)),
		generateNumber: (user) => generateNextReferenceId('payments', 'paymentNumber', 'PAY', user),
		renderRows,
		updateStats: (records) => updateFinancialStats(records),
		matchesFilters: (record, selects) => selects.every((select) => !select.value || select.value === 'all' || select.id !== 'paymentMethodFilter' || String(record.method || '').toLowerCase() === select.value),
		exportColumns: [['Payment number', 'paymentNumber'], ['Customer', 'customerName'], ['Invoice', 'invoiceNumber'], ['Date', 'date'], ['Method', 'method'], ['Amount', 'amount'], ['Status', 'status']],
		isCreateButton: (button) => button.textContent.toLowerCase().includes('record payment')
	};
	pageInstances.set(pageShell, feature);
	return feature;
};
