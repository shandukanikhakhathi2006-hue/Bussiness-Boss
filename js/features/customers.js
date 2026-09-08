import { firestore } from '../firebase/config.js';
import { money } from '../utils/currency.js';
import { getFirstRecordDate } from '../utils/dates.js';
import { getPeriodTotals, getPercentageChange } from '../utils/calculations.js';
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

// Shared by the dashboard and record forms; every read remains owner-scoped.
export const getCustomerSnapshot = (user) =>
	getDocs(query(collection(firestore, 'customers'), where('ownerId', '==', user.uid)));

// The shared controller owns modal, feedback, pagination and event lifecycles.
export const initCustomersPage = ({ pageName, tableBody, statCards, pageEscape, initials, statusClass, updatePageTrends }) => {
	if (pageName !== 'customers') return null;

	const pageDate = (record) => getFirstRecordDate(record, ['date', 'createdAt', 'issueDate']);
	const periodTotals = (records, getValue) => getPeriodTotals(records, getValue, ['date', 'createdAt', 'issueDate']);

	const renderRows = (records) => {
		if (!tableBody) return;
		if (!records.length) {
			tableBody.innerHTML = '<tr><td colspan="8">No customers found yet.</td></tr>';
			return;
		}
		tableBody.innerHTML = records.map((record) => `<tr data-record-id="${record.id}"><td><div class="customer"><div class="customer-avatar">${pageEscape(initials(record.name))}</div><span>${pageEscape(record.name || 'Customer')}</span></div></td><td>${pageEscape(record.email || 'Not set')}</td><td>${pageEscape(record.phone || 'Not set')}</td><td>${money(record.totalSpent)}</td><td><span class="status-badge ${statusClass(record.status)}">${pageEscape(record.status || 'Active')}</span></td><td><button class="view-button" type="button" data-page-action="edit">Edit</button> <button class="view-button" type="button" data-page-action="delete">Delete</button></td></tr>`).join('');
	};

	const updateStats = (records) => {
		if (statCards[0]) statCards[0].textContent = records.length;
		if (statCards[1]) statCards[1].textContent = records.filter((record) => String(record.status || 'active').toLowerCase() === 'active').length;
		if (statCards[2]) statCards[2].textContent = records.filter((record) => { const date = pageDate(record); const now = new Date(); return date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear(); }).length;
		if (statCards[3]) statCards[3].textContent = records.filter((record) => String(record.group || record.type || '').toLowerCase() === 'vip').length;
		if (statCards[4]) statCards[4].textContent = records.filter((record) => String(record.status || '').toLowerCase() === 'inactive').length;
		const customerTotals = periodTotals(records, () => 1);
		const newCustomers = records.filter((record) => { const date = pageDate(record); const now = new Date(); return date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear(); });
		updatePageTrends([getPercentageChange(customerTotals.current, customerTotals.previous), getPercentageChange(records.filter((record) => String(record.status || 'active').toLowerCase() === 'active').length, 0), getPercentageChange(newCustomers.length, 0), 0, 0]);
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
