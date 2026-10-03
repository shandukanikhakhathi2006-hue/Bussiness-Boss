import { firestore } from '../firebase/config.js';
import { money } from '../utils/currency.js';
import { renderTableState } from '../utils/recordTable.js';
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

// Shared by the dashboard and record forms; every read remains owner-scoped.
export const getCustomerSnapshot = (user) =>
	getDocs(query(collection(firestore, 'customers'), where('ownerId', '==', user.uid)));

// The shared controller owns modal, feedback, pagination and event lifecycles.
export const initCustomersPage = ({ pageName, tableBody, statCards, pageEscape, initials, statusClass }) => {
	if (pageName !== 'customers') return null;

	const renderRows = (records) => {
		if (!tableBody) return;
		if (!records.length) {
			renderTableState(tableBody, { message: 'No customers yet. Add a customer to start your directory.' });
			return;
		}
		tableBody.innerHTML = records.map((record) => {
			const name = record.name || 'Customer';
			const contact = [record.email, record.phone].filter(Boolean);
			return `<tr data-record-id="${pageEscape(record.id)}"><td><div class="customer"><div class="customer-avatar" aria-hidden="true">${pageEscape(initials(name))}</div><span class="customer-name">${pageEscape(name)}</span></div></td><td><div class="customer-contact">${contact.length ? contact.map((value) => `<span>${pageEscape(value)}</span>`).join('') : '<span>No contact details</span>'}</div></td><td>${money(record.totalSpent)}</td><td><span class="status-badge ${statusClass(record.status)}">${pageEscape(record.status || 'Active')}</span></td><td class="customer-actions"><button class="view-button" type="button" data-page-action="edit" aria-label="Edit ${pageEscape(name)}">Edit</button><button class="view-button" type="button" data-page-action="delete" aria-label="Delete ${pageEscape(name)}">Delete</button></td></tr>`;
		}).join('');
	};

	const updateStats = (records) => {
		if (statCards[0]) statCards[0].textContent = records.length;
		if (statCards[1]) statCards[1].textContent = records.filter((record) => String(record.status || 'active').toLowerCase() === 'active').length;
		if (statCards[2]) statCards[2].textContent = records.filter((record) => String(record.status || '').toLowerCase() === 'inactive').length;
	};

	const saveRecord = async (user, values, recordId = null) => {
		const record = { name: values.name, email: values.email, phone: values.phone, status: values.status, updatedAt: serverTimestamp() };
		if (!recordId) {
			record.ownerId = user.uid;
			record.createdAt = serverTimestamp();
		}
		await setDoc(recordId ? doc(firestore, 'customers', recordId) : doc(collection(firestore, 'customers')), record, { merge: true });
	};

	return {
		singularTitle: 'Customer',
		fields: [
			{ name: 'name', label: 'Customer name', required: true },
			{ name: 'email', label: 'Customer email' },
			{ name: 'phone', label: 'Customer phone' },
			{ name: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] }
		],
		exportColumns: [['Name', 'name'], ['Email', 'email'], ['Phone', 'phone'], ['Status', 'status'], ['Created', 'createdAt']],
		getSnapshot: getCustomerSnapshot,
		saveRecord,
		deleteRecord: (recordId) => deleteDoc(doc(firestore, 'customers', recordId)),
		renderRows,
		updateStats,
		isCreateButton: (button) => button.textContent.toLowerCase().includes('add customer'),
		matchesFilters: (record, selects) => selects.every((select) => !select.value || select.value === 'all' || select.id !== 'customerStatusFilter' || String(record.status || '').toLowerCase() === select.value)
	};
};
