import { initPaymentsPage } from './js/features/payments.js';
import { initInvoicesPage } from './js/features/invoices.js';
import { initAppointmentsPage } from './js/features/appointments.js';
import { getCustomerSnapshot, initCustomersPage } from './js/features/customers.js';
import { getCurrentUser, getUserProfile, requireAuthenticatedUser, initAuthPages, initLogoutButtons, getFirebaseErrorMessage } from './js/firebase/auth.js';
import { firestore } from './js/firebase/config.js';
import { getFirstRecordDate, isSameDay, getDateRange, getPeriodGranularity } from './js/utils/dates.js';
import { formatCurrency, money, formatAxisValue } from './js/utils/currency.js';
import { isPaidInvoice, buildPeriodSeries, getPercentageChange, getPeriodTotals, getDayTotals, sumAmounts, calculateProfit } from './js/utils/calculations.js';
import {
	updateProfile,
	updateEmail,
	updatePassword,
	reauthenticateWithCredential,
	EmailAuthProvider
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import {
	addDoc,
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	query,
	serverTimestamp,
	setDoc,
	where
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

// Generates the next human-readable reference number (e.g. INV-00001, then INV-00002) for a
// collection, scoped to the current user's own records so one account's numbering never
// collides with another's. Scans existing values instead of counting documents, so deleting
// a record can never cause the next generated ID to repeat one still in use.
const generateNextReferenceId = async (collectionName, fieldName, prefix, user) => {
	const snapshot = await getDocs(query(collection(firestore, collectionName), where('ownerId', '==', user.uid)));
	let highestNumber = 0;
	snapshot.docs.forEach((docSnapshot) => {
		const match = String(docSnapshot.data()[fieldName] || '').match(new RegExp(`^${prefix}-(\\d+)$`));
		if (match) highestNumber = Math.max(highestNumber, Number(match[1]));
	});
	return `${prefix}-${String(highestNumber + 1).padStart(5, '0')}`;
};

const getFirstDisplayName = (nameOrEmail) => {
	const value = String(nameOrEmail || '').trim();
	if (!value) return 'User';
	const firstWord = value.split(/\s+/)[0];
	return firstWord.includes('@') ? firstWord.split('@')[0] : firstWord;
};

// Rounds a revenue chart's highest value up to a clean number (1, 2, 5, or 10 times a power of
// ten) so a y-axis reads "R2,000 / R1,500 / R1,000..." instead of an awkward exact figure.
// Shared by the dashboard's revenue chart and the reports page's revenue chart.
const getNiceAxisMaximum = (value) => {
	if (value <= 0) return 10;
	const magnitude = 10 ** Math.floor(Math.log10(value));
	const normalized = value / magnitude;
	const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
	return niceNormalized * magnitude;
};

// Shared in-app dialog that replaces window.prompt() for creating/editing records.
// Renders a small centered form (title + labeled fields + Save/Cancel) instead of the
// browser's built-in prompt boxes, which look out of place next to the rest of the UI.
// Resolves with an object of trimmed string values keyed by field name on Save, or null
// if the person cancels (Escape, backdrop click, the X, or the Cancel button).
// Required and numeric fields are validated inline before the dialog will close on Save.
const showFormModal = ({ title, description = '', fields, values = {}, submitLabel = 'Save', destructive = false }) => new Promise((resolve) => {
	const overlay = document.createElement('div');
	overlay.className = 'app-modal-overlay';

	const modal = document.createElement('div');
	modal.className = 'app-modal';
	modal.setAttribute('role', 'dialog');
	modal.setAttribute('aria-modal', 'true');

	const form = document.createElement('form');
	form.noValidate = true;

	const header = document.createElement('div');
	header.className = 'app-modal-header';
	const heading = document.createElement('h2');
	heading.textContent = title;
	const closeButton = document.createElement('button');
	closeButton.type = 'button';
	closeButton.className = 'app-modal-close';
	closeButton.setAttribute('aria-label', 'Close');
	closeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';
	header.append(heading, closeButton);
	const descriptionElement = document.createElement('p');
	descriptionElement.className = 'app-modal-description';
	descriptionElement.textContent = description;
	descriptionElement.hidden = !description;

	const fieldsWrapper = document.createElement('div');
	fieldsWrapper.className = 'app-modal-fields';

	const inputs = {};
	fields.forEach((field, index) => {
		const wrapper = document.createElement('div');
		wrapper.className = 'form-field';
		const label = document.createElement('label');
		label.textContent = field.label;
		const inputId = `modal-field-${field.name}-${index}`;
		label.setAttribute('for', inputId);
		wrapper.append(label);

		let input;
		if (field.type === 'select') {
			input = document.createElement('select');
			(field.options || []).forEach((option) => {
				const optionElement = document.createElement('option');
				optionElement.value = option;
				optionElement.textContent = option.charAt(0).toUpperCase() + option.slice(1);
				input.append(optionElement);
			});
		} else {
			input = document.createElement('input');
			input.type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'time' ? 'time' : 'text';
			if (field.type === 'number') input.step = 'any';
			if (field.placeholder) input.placeholder = field.placeholder;
		}
		input.id = inputId;
		input.name = field.name;
		const existingValue = values[field.name];
		input.value = existingValue !== undefined && existingValue !== null ? existingValue : (field.defaultValue ?? '');
		if (field.disabled) input.disabled = true;
		wrapper.append(input);
		fieldsWrapper.append(wrapper);
		inputs[field.name] = input;
	});

	const errorMessage = document.createElement('p');
	errorMessage.className = 'app-modal-error';

	const actions = document.createElement('div');
	actions.className = 'app-modal-actions';
	const cancelButton = document.createElement('button');
	cancelButton.type = 'button';
	cancelButton.className = 'secondary-button';
	cancelButton.textContent = 'Cancel';
	const submitButton = document.createElement('button');
	submitButton.type = 'submit';
	submitButton.className = destructive ? 'danger-button' : 'primary-button';
	submitButton.textContent = submitLabel;
	actions.append(cancelButton, submitButton);

	form.append(header, descriptionElement, fieldsWrapper, errorMessage, actions);
	modal.append(form);
	overlay.append(modal);
	document.body.append(overlay);

	const previouslyFocused = document.activeElement;
	(inputs[fields[0]?.name] || cancelButton).focus();

	let settled = false;
	const close = (result) => {
		if (settled) return;
		settled = true;
		document.removeEventListener('keydown', onKeydown);
		overlay.remove();
		if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
		resolve(result);
	};

	const onKeydown = (event) => {
		if (event.key === 'Escape') {
			close(null);
			return;
		}
		if (event.key !== 'Tab') return;
		const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (!first || !last) return;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};
	document.addEventListener('keydown', onKeydown);

	overlay.addEventListener('mousedown', (event) => {
		if (event.target === overlay) close(null);
	});
	closeButton.addEventListener('click', () => close(null));
	cancelButton.addEventListener('click', () => close(null));

	form.addEventListener('submit', (event) => {
		event.preventDefault();
		errorMessage.classList.remove('visible');
		const result = {};
		for (const field of fields) {
			const input = inputs[field.name];
			const rawValue = input.value.trim();
			if (field.required && !rawValue) {
				errorMessage.textContent = `${field.label} is required.`;
				errorMessage.classList.add('visible');
				input.focus();
				return;
			}
			if (field.type === 'number' && rawValue && !Number.isFinite(Number(rawValue))) {
				errorMessage.textContent = `${field.label} must be a number.`;
				errorMessage.classList.add('visible');
				input.focus();
				return;
			}
			result[field.name] = rawValue;
		}
		close(result);
	});
});

document.addEventListener('DOMContentLoaded', () => {
	const showMessage = (message, type = 'success') => {
		let messageElement = document.querySelector('[data-script-message]');

		if (!messageElement) {
			messageElement = document.createElement('p');
			messageElement.dataset.scriptMessage = 'true';
			messageElement.setAttribute('role', 'status');
			messageElement.style.marginTop = '1rem';
			messageElement.style.marginBottom = '1rem';
			messageElement.style.padding = '0.75rem 1rem';
			messageElement.style.borderRadius = '6px';
			messageElement.style.fontWeight = '600';
			const target = document.querySelector('form') || document.querySelector('main') || document.body;
			target.append(messageElement);
		}

		// If the page pre-places an icon + text layout (see login.html, signup.html), fill in
		// just the text/icon so the rest survives; otherwise fall back to the plain message.
		const textTarget = messageElement.querySelector('[data-script-message-text]') || messageElement;
		textTarget.textContent = message;
		const iconTarget = messageElement.querySelector('[data-script-message-icon]');
		if (iconTarget) iconTarget.textContent = type === 'error' ? 'error' : 'check_circle';
		messageElement.hidden = false;
		messageElement.style.color = type === 'error' ? '#b42318' : '#067647';
		messageElement.style.backgroundColor = type === 'error' ? '#fef3f2' : '#ecfdf3';
		messageElement.style.borderLeftColor = type === 'error' ? '#b42318' : '#067647';
	};

	// ---- Upgrade to Pro ---------------------------------------------------
	// The Pro plan name/price/features below are copied from pricing.html and
	// should stay in sync with it. There is no real billing integration yet
	// (Peach Payments comes in a later stage), and Firestore Security Rules
	// now reject any client write to users/{uid}.plan or .planUpdatedAt, so
	// this flow is informational only — it never writes to Firestore. Once a
	// real payment provider is wired up, this should be replaced with an
	// actual checkout flow whose confirmation is written server-side
	// (Cloud Function / webhook), not from the browser.
	const PRO_PLAN = {
		name: 'Professional',
		price: 'R199/month',
		features: [
			'Unlimited Customers',
			'Unlimited Appointments',
			'Advanced Reports',
			'Inventory Management',
			'WhatsApp Reminders',
			'Priority Support'
		]
	};

	const showUpgradeConfirmModal = () => new Promise((resolve) => {
		const overlay = document.createElement('div');
		overlay.className = 'app-modal-overlay';

		const modal = document.createElement('div');
		modal.className = 'app-modal';
		modal.setAttribute('role', 'dialog');
		modal.setAttribute('aria-modal', 'true');

		const header = document.createElement('div');
		header.className = 'app-modal-header';
		const heading = document.createElement('h2');
		heading.textContent = 'Upgrade to BusinessBoss Pro?';
		const closeButton = document.createElement('button');
		closeButton.type = 'button';
		closeButton.className = 'app-modal-close';
		closeButton.setAttribute('aria-label', 'Close');
		closeButton.innerHTML = '<i class="fa-solid fa-xmark"></i>';
		header.append(heading, closeButton);

		const body = document.createElement('div');
		body.className = 'app-modal-fields';

		const priceLine = document.createElement('p');
		priceLine.className = 'upgrade-plan-summary';
		priceLine.textContent = `${PRO_PLAN.name} Plan — ${PRO_PLAN.price}`;
		body.append(priceLine);

		const featuresList = document.createElement('ul');
		featuresList.className = 'upgrade-feature-list';
		PRO_PLAN.features.forEach((feature) => {
			const item = document.createElement('li');
			item.textContent = feature;
			featuresList.append(item);
		});
		body.append(featuresList);

		const note = document.createElement('p');
		note.className = 'upgrade-note';
		note.textContent = 'Online upgrades aren\'t connected to billing yet, so nothing will be charged or changed on your account today.';
		body.append(note);

		const actions = document.createElement('div');
		actions.className = 'app-modal-actions';
		const cancelButton = document.createElement('button');
		cancelButton.type = 'button';
		cancelButton.className = 'secondary-button';
		cancelButton.textContent = 'Close';
		const confirmButton = document.createElement('button');
		confirmButton.type = 'button';
		confirmButton.className = 'primary-button';
		confirmButton.textContent = 'Got it';
		actions.append(cancelButton, confirmButton);

		modal.append(header, body, actions);
		overlay.append(modal);
		document.body.append(overlay);

		let settled = false;
		const close = (result) => {
			if (settled) return;
			settled = true;
			document.removeEventListener('keydown', onKeydown);
			overlay.remove();
			resolve(result);
		};

		const onKeydown = (event) => { if (event.key === 'Escape') close(false); };
		document.addEventListener('keydown', onKeydown);

		overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(false); });
		closeButton.addEventListener('click', () => close(false));
		cancelButton.addEventListener('click', () => close(false));
		confirmButton.addEventListener('click', () => close(true));

		confirmButton.focus();
	});

	// Reflects the Firestore-sourced plan on the sidebar "Upgrade to Pro" card
	// (present on every internal page) and (re)binds the click handler once.
	const renderUpgradeCard = (isPro) => {
		const card = document.querySelector('.upgrade-card');
		if (!card) return;
		const button = card.querySelector('button');
		const heading = card.querySelector('h4');
		const description = card.querySelector('p');
		if (!button) return;

		card.classList.toggle('is-pro', isPro);
		if (heading) heading.textContent = isPro ? 'Pro Plan' : 'Upgrade to Pro';
		if (description) description.textContent = isPro
			? 'You have full access to all Pro features.'
			: 'Unlock more features and grow your business faster.';
		button.textContent = isPro ? 'Current Plan' : 'Upgrade Now';
		button.disabled = isPro;

		if (!button.dataset.upgradeBound) {
			button.dataset.upgradeBound = 'true';
			button.addEventListener('click', handleUpgradeClick);
		}
	};

	let upgradeInProgress = false;

	// Looks up the CURRENT authenticated user's Firestore-sourced plan (never
	// trusts a plan value passed around in the UI) before deciding whether
	// there's anything to show.
	const handleUpgradeClick = async () => {
		if (upgradeInProgress) return;

		const user = getCurrentUser();
		if (!user) {
			showMessage('Please log in to upgrade your plan.', 'error');
			return;
		}

		upgradeInProgress = true;
		try {
			const profileSnapshot = await getDoc(doc(firestore, 'users', user.uid));
			if (profileSnapshot.data()?.plan === 'pro') {
				showMessage('You are already on the Pro plan.');
				renderUpgradeCard(true);
				return;
			}

			// Purely informational: no Firestore write happens here. Real plan
			// changes will only ever be made server-side once billing exists —
			// Firestore Security Rules already reject a client attempt to set
			// users/{uid}.plan directly, so this modal is the honest UI for
			// that today rather than a flow that would just fail silently.
			await showUpgradeConfirmModal();
		} catch (error) {
			console.error('Failed to show the upgrade dialog', error);
		} finally {
			upgradeInProgress = false;
		}
	};
	// ------------------------------------------------------------------------

	document.querySelectorAll('a[href="#"]').forEach((link) => {
		link.addEventListener('click', (event) => event.preventDefault());
	});

	const learnMoreLink = document.querySelector('.btn-secondary');
	if (learnMoreLink) {
		learnMoreLink.href = 'features.html';
	}

	initAuthPages(showMessage);
	initLogoutButtons(showMessage);

	const contactForm = document.querySelector('.contact-form form');
	if (contactForm) {
		contactForm.addEventListener('submit', (event) => {
			event.preventDefault();
			contactForm.reset();
			showMessage('Thanks for reaching out. We will reply shortly.');
		});
	}

	document.querySelectorAll('.pricing-card button').forEach((button) => {
		button.addEventListener('click', () => {
			const plan = button.closest('.pricing-card').querySelector('h2').textContent;
			if (plan === 'Enterprise') {
				window.location.href = 'Contact.html';
				return;
			}
			localStorage.setItem('businessBossSelectedPlan', plan);
			window.location.href = 'signup.html';
		});
	});

	const dashboard = document.querySelector('.dashboard');
	if (dashboard) {
		const menuButton = document.querySelector('#menuButton');
		const sidebar = document.querySelector('#sidebar');
		const viewAllInvoicesButton = document.querySelector('#viewAllInvoicesButton');
		const invoiceTableBody = document.querySelector('#invoiceTableBody');
		const viewCalendarButton = document.querySelector('#viewCalendarButton');
		const calendarModal = document.querySelector('#calendarModal');
		const closeCalendarButton = document.querySelector('#closeCalendarButton');
		const previousMonthButton = document.querySelector('#previousMonthButton');
		const nextMonthButton = document.querySelector('#nextMonthButton');
		const calendarMonthLabel = document.querySelector('#calendarMonthLabel');
		const calendarGrid = document.querySelector('#calendarGrid');
		const calendarToolbar = document.querySelector('#calendarToolbar');
		const calendarDayView = document.querySelector('#calendarDayView');
		const calendarDayViewLabel = document.querySelector('#calendarDayViewLabel');
		const calendarDaySlots = document.querySelector('#calendarDaySlots');
		const backToMonthButton = document.querySelector('#backToMonthButton');
		const profileAvatar = document.querySelector('#profileAvatar');
		const profileImageInput = document.querySelector('#profileImageInput');
		const profileAvatarUpload = document.querySelector('.profile-avatar-upload');
		const profileMenuButton = document.querySelector('#profileMenuButton');
		const profileDropdown = document.querySelector('#profileDropdown');
		const profileDropdownName = document.querySelector('#profileDropdownName');
		const profileDropdownEmail = document.querySelector('#profileDropdownEmail');
		const revenueChartLine = document.querySelector('#revenueChartLine');
		const revenueChartLabels = document.querySelector('#revenueChartLabels');
		const revenueYAxis = dashboard.querySelector('.chart .y-axis');
		const serviceRevenueTotal = document.querySelector('#serviceRevenueTotal');
		const serviceRevenueList = document.querySelector('#serviceRevenueList');
		const appointmentTableBody = document.querySelector('#appointmentTableBody');
		const viewAllAppointmentsButton = document.querySelector('#viewAllAppointmentsButton');
		const searchInput = document.querySelector('#searchInput');
		const newTransactionButton = document.querySelector('#newTransactionButton');
		const notificationsButton = document.querySelector('#notificationsButton');
		const notificationsPanel = document.querySelector('#notificationsPanel');
		const notificationsList = document.querySelector('#notificationsList');
		const notificationsSummary = document.querySelector('#notificationsSummary');
		const notificationDot = document.querySelector('#notificationDot');
		const statCards = dashboard.querySelectorAll('.stat-card');
		let bookingsForCalendar = [];
		let calendarDate = new Date();

		const setNotificationsOpen = (isOpen) => {
			if (!notificationsPanel || !notificationsButton) return;
			notificationsPanel.hidden = !isOpen;
			notificationsButton.setAttribute('aria-expanded', String(isOpen));
		};

		const renderNotifications = (notifications) => {
			if (!notificationsList || !notificationsSummary || !notificationDot) return;
			notificationDot.hidden = notifications.length === 0;
			notificationsSummary.textContent = notifications.length ? `${notifications.length} to review` : 'All caught up';
			notificationsList.innerHTML = notifications.length
				? notifications.map((notification) => `<button type="button" class="notification-item ${notification.tone || ''}" data-notification-link="${notification.link}"><span class="notification-item-icon"><i class="fa-solid ${notification.icon}"></i></span><span><strong>${escapeHtml(notification.title)}</strong><span>${escapeHtml(notification.detail)}</span></span></button>`).join('')
				: '<div class="notification-item"><span class="notification-item-icon"><i class="fa-solid fa-check"></i></span><span><strong>You are all caught up</strong><span>No business records need attention right now.</span></span></div>';
		};

		newTransactionButton?.addEventListener('click', async () => {
			const choice = await showFormModal({
				title: 'Create a new record',
				submitLabel: 'Continue',
				fields: [{
					name: 'recordType',
					label: 'What would you like to create?',
					type: 'select',
					options: ['Invoice', 'Payment', 'Expense'],
					required: true
				}]
			});
			if (!choice) return;
			const destinations = { Invoice: 'invoices.html?new=1', Payment: 'payments.html?new=1', Expense: 'expenses.html?new=1' };
			window.location.href = destinations[choice.recordType] || 'invoices.html?new=1';
		});
		let invoiceRecords = [];
		let showingAllInvoices = false;
		let appointmentRecords = [];
		let showingAllAppointments = false;
		const periodSelect = document.querySelector('#periodSelect');
		let latestInvoiceData = [];
		let latestExpenseData = [];
		statCards.forEach((card) => {
			const value = card.querySelector('h2');
			if (value) value.textContent = 'Loading...';
		});
		if (appointmentTableBody) appointmentTableBody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
		if (invoiceTableBody) invoiceTableBody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';

		const getInitials = (name) => String(name || 'Business Manager')
			.split(' ')
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0].toUpperCase())
			.join('');

		const renderProfileAvatar = (user, imageUrl = user.photoURL) => {
			if (!profileAvatar) return;
			profileAvatar.textContent = '';
			if (imageUrl) {
				const image = document.createElement('img');
				image.src = imageUrl;
				image.alt = `${user.displayName || user.email || 'Business manager'} profile`;
				profileAvatar.append(image);
				return;
			}
			profileAvatar.textContent = getInitials(user.displayName || user.email);
		};

		const setProfileDropdownOpen = (isOpen) => {
			if (!profileDropdown || !profileMenuButton) return;
			profileDropdown.hidden = !isOpen;
			profileMenuButton.setAttribute('aria-expanded', String(isOpen));
		};

		const resizeProfileImage = (file) => new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const image = new Image();
				image.onload = () => {
					const size = 256;
					const scale = Math.min(size / image.width, size / image.height, 1);
					const canvas = document.createElement('canvas');
					canvas.width = Math.max(1, Math.round(image.width * scale));
					canvas.height = Math.max(1, Math.round(image.height * scale));
					canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
					resolve(canvas.toDataURL('image/jpeg', 0.82));
				};
				image.onerror = () => reject(new Error('The selected image could not be read.'));
				image.src = reader.result;
			};
			reader.onerror = () => reject(new Error('The selected image could not be read.'));
			reader.readAsDataURL(file);
		});

		const getRecordDate = (record, fields = ['createdAt']) => getFirstRecordDate(record, fields);

		const formatTrend = (change) => `${change > 0 ? '+' : ''}${change}%`;

		const updateTrend = (key, change) => {
			const trend = dashboard.querySelector(`[data-trend="${key}"]`);
			if (!trend) return;
			trend.textContent = formatTrend(change);
			trend.classList.toggle('positive', change >= 0);
			trend.classList.toggle('negative', change < 0);
		};

		const updatePerformanceTrend = (key, change) => {
			const trend = dashboard.querySelector(`[data-performance-trend="${key}"]`);
			if (!trend) return;
			trend.textContent = formatTrend(change);
			trend.classList.toggle('green-text', change >= 0);
			trend.classList.toggle('red-text', change < 0);
		};

		// Renders the revenue chart, Y-axis, and Business Performance figures for whichever
		// period is currently selected in #periodSelect, using the cached invoice/expense data
		// (no refetch needed when the dropdown changes).
		const renderRevenueChartForPeriod = () => {
			const period = periodSelect?.value || 'This Month';
			const range = getDateRange(period);
			const granularity = getPeriodGranularity(period);
			const paidRecords = latestInvoiceData.filter(isPaidInvoice);
			const revenueSeries = buildPeriodSeries(paidRecords, range, granularity, ['createdAt', 'date'], (invoice) => Number(invoice.amount || 0));
			const expenseSeries = buildPeriodSeries(latestExpenseData, range, granularity, ['createdAt', 'date'], (expense) => Number(expense.amount || 0));
			const revenueTotal = revenueSeries.values.reduce((sum, value) => sum + value, 0);
			const expenseTotal = expenseSeries.values.reduce((sum, value) => sum + value, 0);
			const profit = calculateProfit(revenueTotal, expenseTotal);

			if (dashboard.querySelector('[data-performance-value="revenue"]')) {
				dashboard.querySelector('[data-performance-value="revenue"]').textContent = formatCurrency(revenueTotal);
				dashboard.querySelector('[data-performance-value="expenses"]').textContent = formatCurrency(expenseTotal);
				dashboard.querySelector('[data-performance-value="profit"]').textContent = formatCurrency(profit);
			}
			if (serviceRevenueTotal) serviceRevenueTotal.textContent = formatCurrency(revenueTotal);

			const rawMaximum = Math.max(...revenueSeries.values, 0);
			const axisMaximum = getNiceAxisMaximum(rawMaximum);
			if (revenueChartLine) {
				const pointCount = revenueSeries.values.length;
				revenueChartLine.setAttribute('points', revenueSeries.values.map((value, index) => {
					const x = pointCount > 1 ? (index / (pointCount - 1)) * 700 : 350;
					const y = 220 - (value / axisMaximum) * 185;
					return `${x},${y}`;
				}).join(' '));
			}
			if (revenueChartLabels) {
				revenueChartLabels.innerHTML = revenueSeries.labels.map((label) => `<span>${escapeHtml(label)}</span>`).join('');
			}
			if (revenueYAxis) {
				const steps = 5;
				revenueYAxis.innerHTML = Array.from({ length: steps + 1 }, (_, index) => `<span>R${formatAxisValue(axisMaximum * (1 - index / steps))}</span>`).join('');
			}

			if (serviceRevenueList) {
				const serviceTotals = paidRecords.reduce((totals, invoice) => {
					const date = getRecordDate(invoice, ['createdAt', 'date']);
					if (!date || date < range.start || date >= range.end) return totals;
					const service = invoice.service || invoice.serviceName || invoice.category || 'Other';
					totals[service] = (totals[service] || 0) + Number(invoice.amount || 0);
					return totals;
				}, {});
				const colors = ['blue-dot', 'purple-dot', 'green-dot', 'orange-dot', 'red-dot'];
				const services = Object.entries(serviceTotals).sort(([, first], [, second]) => second - first).slice(0, 5);
				serviceRevenueList.innerHTML = services.length
					? services.map(([service, total], index) => `<div><span><i class="service-dot ${colors[index]}"></i>${escapeHtml(service)}</span><strong>${revenueTotal ? Math.round((total / revenueTotal) * 100) : 0}%</strong></div>`).join('')
					: '<div><span><i class="service-dot blue-dot"></i>No service data</span><strong>0%</strong></div>';
			}
		};

		const renderRevenueAnalytics = (records, expenses) => {
			latestInvoiceData = records;
			latestExpenseData = expenses;
			renderRevenueChartForPeriod();
		};

		const escapeHtml = (value) => String(value ?? '')
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#039;');

		const getInvoiceStatusClass = (status) => {
			const normalizedStatus = String(status || 'pending').toLowerCase();
			return normalizedStatus === 'paid' ? 'completed' : normalizedStatus === 'overdue' ? 'overdue' : 'pending';
		};

		const getBookingStatusClass = (status) => {
			const normalizedStatus = String(status || 'pending').toLowerCase();
			if (normalizedStatus === 'completed') return 'completed';
			if (normalizedStatus === 'cancelled' || normalizedStatus === 'canceled') return 'cancelled';
			return 'pending';
		};

		const renderAppointmentRows = (records) => {
			if (!appointmentTableBody) return;
			if (!records.length) {
				appointmentTableBody.innerHTML = '<tr><td colspan="5">No appointments scheduled for today.</td></tr>';
				return;
			}
			// Records are already filtered to today, so sort by time-of-day (HH:MM as minutes
			// since midnight) rather than by date, which is identical for every row here.
			const timeToMinutes = (time) => {
				const match = String(time || '').match(/^(\d{1,2}):(\d{2})/);
				return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
			};
			const sortedRecords = [...records].sort((first, second) => timeToMinutes(first.time) - timeToMinutes(second.time));
			const recordsToShow = showingAllAppointments ? sortedRecords : sortedRecords.slice(0, 5);
			appointmentTableBody.innerHTML = recordsToShow.map((booking) => {
				const customerName = booking.customerName || booking.customer || 'Customer';
				const appointmentTime = booking.time || 'No time set';
				const status = String(booking.status || 'Pending');
				return `
					<tr>
						<td>${escapeHtml(appointmentTime)}</td>
						<td><div class="customer"><div class="customer-avatar">${escapeHtml(getInitials(customerName))}</div><span>${escapeHtml(customerName)}</span></div></td>
						<td>${escapeHtml(booking.service || booking.serviceName || 'Appointment')}</td>
						<td><span class="status ${getBookingStatusClass(status)}">${escapeHtml(status)}</span></td>
				<td><button class="view-button" type="button" data-dashboard-link="appointments.html">View schedule</button></td>
					</tr>`;
			}).join('');
		};

		const renderInvoiceRows = () => {
			if (!invoiceTableBody) return;
			if (!invoiceRecords.length) {
				invoiceTableBody.innerHTML = '<tr><td colspan="6">No invoices found yet.</td></tr>';
				return;
			}
			const recordsToShow = showingAllInvoices ? invoiceRecords : invoiceRecords.slice(0, 5);
			invoiceTableBody.innerHTML = recordsToShow.map((invoice) => {
				const invoiceNumber = invoice.invoiceNumber || invoice.number || invoice.id;
				const status = String(invoice.status || 'Pending');
				return `
					<tr>
						<td><strong>${escapeHtml(invoiceNumber)}</strong></td>
						<td>${escapeHtml(invoice.customerName || invoice.customer || 'Customer')}</td>
						<td>${money(invoice.amount)}</td>
						<td>${escapeHtml(invoice.dueDate || invoice.date || 'Not set')}</td>
						<td><span class="status ${getInvoiceStatusClass(status)}">${escapeHtml(status)}</span></td>
				<td><button class="view-button" type="button" data-dashboard-link="invoices.html">View invoices</button></td>
					</tr>`;
			}).join('');
		};

		const renderCalendar = () => {
			if (!calendarGrid || !calendarMonthLabel) return;
			const year = calendarDate.getFullYear();
			const month = calendarDate.getMonth();
			const firstDay = new Date(year, month, 1).getDay();
			const daysInMonth = new Date(year, month + 1, 0).getDate();
			const monthName = new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(calendarDate);
			const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
			calendarMonthLabel.textContent = monthName;
			calendarGrid.innerHTML = dayNames.map((day) => `<span class="calendar-day-name">${day}</span>`).join('');

			for (let emptyDay = 0; emptyDay < firstDay; emptyDay += 1) {
				calendarGrid.insertAdjacentHTML('beforeend', '<span class="calendar-day empty" aria-hidden="true"></span>');
			}

			for (let day = 1; day <= daysInMonth; day += 1) {
				const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
				const matchingBookings = bookingsForCalendar.filter((booking) => String(booking.date || '').startsWith(dateKey));
				const bookingText = matchingBookings.length ? `${matchingBookings.length} booking${matchingBookings.length === 1 ? '' : 's'}` : 'No bookings';
				calendarGrid.insertAdjacentHTML(
					'beforeend',
					`<button type="button" class="calendar-day${matchingBookings.length ? ' has-bookings' : ''}" data-date="${dateKey}"><strong>${day}</strong><span>${bookingText}</span></button>`
				);
			}
		};

		// Business hours the day view breaks appointments into. Each appointment is placed in
		// the slot matching the hour of its saved "time" field (e.g. 10:30 -> the 10:00 slot).
		const CALENDAR_HOURS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

		const renderCalendarDayView = (dateKey) => {
			if (!calendarDaySlots || !calendarDayViewLabel) return;
			const [year, month, day] = dateKey.split('-').map(Number);
			const dayDate = new Date(year, month - 1, day);
			calendarDayViewLabel.textContent = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'full' }).format(dayDate);
			const dayBookings = bookingsForCalendar.filter((booking) => String(booking.date || '').startsWith(dateKey));
			const usedBookingIndexes = new Set();
			const bookingHtml = (booking, fallbackTimeLabel) => `<div class="calendar-slot-booking"><strong>${escapeHtml(booking.time || fallbackTimeLabel)}</strong> ${escapeHtml(booking.customerName || booking.customer || 'Customer')}${booking.service ? ` &middot; ${escapeHtml(booking.service)}` : ''}</div>`;
			const hourSlotsHtml = CALENDAR_HOURS.map((hour) => {
				const hourNumber = Number(hour.split(':')[0]);
				const slotBookings = dayBookings.filter((booking, index) => {
					if (Number(String(booking.time || '').split(':')[0]) !== hourNumber) return false;
					usedBookingIndexes.add(index);
					return true;
				});
				const slotContent = slotBookings.length
					? slotBookings.map((booking) => bookingHtml(booking, hour)).join('')
					: '<div class="calendar-slot-empty">No bookings</div>';
				return `<div class="calendar-slot"><span class="calendar-slot-time">${hour}</span><div class="calendar-slot-content">${slotContent}</div></div>`;
			});
			// Bookings outside the 08:00-17:00 grid (early morning, evening, or no
			// parseable time) still count on the month view, so they need a home here too
			// instead of silently disappearing when a day is opened.
			const leftoverBookings = dayBookings.filter((booking, index) => !usedBookingIndexes.has(index));
			const leftoverSlotHtml = leftoverBookings.length
				? [`<div class="calendar-slot"><span class="calendar-slot-time">Other</span><div class="calendar-slot-content">${leftoverBookings.map((booking) => bookingHtml(booking, 'No time set')).join('')}</div></div>`]
				: [];
			calendarDaySlots.innerHTML = [...hourSlotsHtml, ...leftoverSlotHtml].join('');
			if (calendarGrid) calendarGrid.hidden = true;
			if (calendarToolbar) calendarToolbar.hidden = true;
			calendarDayView.hidden = false;
		};

		const showCalendarMonthView = () => {
			if (calendarGrid) calendarGrid.hidden = false;
			if (calendarToolbar) calendarToolbar.hidden = false;
			if (calendarDayView) calendarDayView.hidden = true;
		};

		const getUserRecords = async (collectionName, user) => {
			const recordsQuery = query(
				collection(firestore, collectionName),
				where('ownerId', '==', user.uid)
			);
			return getDocs(recordsQuery);
		};

		const updateDashboardData = async (user) => {
			try {
				const [customers, bookings, invoices, expenses] = await Promise.all([
					getCustomerSnapshot(user),
					getUserRecords('bookings', user),
					getUserRecords('invoices', user),
					getUserRecords('expenses', user)
				]);
				bookingsForCalendar = bookings.docs.map((record) => record.data());
				invoiceRecords = invoices.docs.map((record) => ({ ...record.data(), id: record.id }));
				renderInvoiceRows();
				const invoiceData = invoiceRecords;
				const expenseData = expenses.docs.map((record) => record.data());
				renderRevenueAnalytics(invoiceData, expenseData);
				const customerTotals = getPeriodTotals(customers.docs.map((record) => record.data()), () => 1, ['createdAt']);
				const bookingData = bookings.docs.map((record) => ({ ...record.data(), id: record.id }));
				const today = new Date();
				appointmentRecords = bookingData.filter((booking) => isSameDay(getRecordDate(booking, ['date', 'createdAt']), today));
				renderAppointmentRows(appointmentRecords);
				const bookingTotals = getDayTotals(bookingData, () => 1, ['date', 'createdAt']);
				const revenueTotals = getPeriodTotals(invoiceData.filter(isPaidInvoice), (invoice) => Number(invoice.amount || 0), ['createdAt', 'date']);
				const expenseTotals = getPeriodTotals(expenseData, (expense) => Number(expense.amount || 0), ['createdAt', 'date']);
				const outstandingRecords = invoiceData.filter((invoice) => String(invoice.status || '').toLowerCase() !== 'paid');
				const outstandingTotals = getPeriodTotals(outstandingRecords, (invoice) => Number(invoice.amount || 0), ['createdAt', 'date']);
				const overdueInvoices = outstandingRecords.filter((invoice) => String(invoice.status || '').toLowerCase() === 'overdue');
				const activeTodayAppointments = appointmentRecords.filter((booking) => !['completed', 'cancelled', 'canceled'].includes(String(booking.status || '').toLowerCase()));
				renderNotifications([
					...(overdueInvoices.length ? [{ title: `${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? '' : 's'}`, detail: 'Review outstanding payments that need follow-up.', link: 'invoices.html', icon: 'fa-triangle-exclamation', tone: 'warning' }] : []),
					...(activeTodayAppointments.length ? [{ title: `${activeTodayAppointments.length} appointment${activeTodayAppointments.length === 1 ? '' : 's'} today`, detail: 'Open the schedule to see your upcoming bookings.', link: 'appointments.html', icon: 'fa-calendar-check' }] : [])
				]);
				const profitTotals = {
					current: calculateProfit(revenueTotals.current, expenseTotals.current),
					previous: calculateProfit(revenueTotals.previous, expenseTotals.previous)
				};

				if (statCards[0]) statCards[0].querySelector('h2').textContent = customers.size.toLocaleString();
				if (statCards[1]) statCards[1].querySelector('h2').textContent = bookingTotals.current.toLocaleString();
				if (statCards[2]) statCards[2].querySelector('h2').textContent = formatCurrency(revenueTotals.current);
				if (statCards[3]) statCards[3].querySelector('h2').textContent = formatCurrency(outstandingTotals.current);
				if (statCards[4]) statCards[4].querySelector('h2').textContent = formatCurrency(expenseTotals.current);

				updateTrend('customers', getPercentageChange(customerTotals.current, customerTotals.previous));
				updateTrend('bookings', getPercentageChange(bookingTotals.current, bookingTotals.previous));
				updateTrend('revenue', getPercentageChange(revenueTotals.current, revenueTotals.previous));
				updateTrend('outstanding', getPercentageChange(outstandingTotals.current, outstandingTotals.previous));
				updateTrend('expenses', getPercentageChange(expenseTotals.current, expenseTotals.previous));
				updatePerformanceTrend('revenue', getPercentageChange(revenueTotals.current, revenueTotals.previous));
				updatePerformanceTrend('expenses', getPercentageChange(expenseTotals.current, expenseTotals.previous));
				updatePerformanceTrend('profit', getPercentageChange(profitTotals.current, profitTotals.previous));
			} catch (error) {
				showMessage('Dashboard data could not be loaded from Firestore.', 'error');
			}
		};

		const addRecordFromPrompt = async (collectionName, title, fields, user) => {
			const values = await showFormModal({ title, fields });
			if (!values) return;
			const record = {};
			for (const field of fields) {
				record[field.name] = field.type === 'number' ? Number(values[field.name]) : values[field.name];
			}
			record.ownerId = user.uid;
			record.createdAt = serverTimestamp();
			await addDoc(collection(firestore, collectionName), record);
			showMessage(`${collectionName.slice(0, -1)} saved to Firestore.`);
			await updateDashboardData(user);
		};

		requireAuthenticatedUser(async (user) => {
			const profile = document.querySelector('.profile-info strong');
			if (profile) profile.textContent = getFirstDisplayName(user.displayName || user.email);
			if (profileDropdownName) profileDropdownName.textContent = user.displayName || 'Business Manager';
			if (profileDropdownEmail) profileDropdownEmail.textContent = user.email || 'Signed-in account';
			const profileDocument = await getUserProfile(user);
			renderProfileAvatar(user, profileDocument.data()?.photoURL || user.photoURL);
			renderUpgradeCard(profileDocument.data()?.plan === 'pro');
			await updateDashboardData(user);
		});

		menuButton?.addEventListener('click', () => {
			// Keep this breakpoint aligned with dashboard.css: at 700px and below the
			// sidebar becomes an off-canvas drawer; above it, the same control simply
			// collapses the persistent sidebar.
			if (window.matchMedia('(max-width: 700px)').matches) {
				const isOpen = sidebar?.classList.toggle('open');
				menuButton.setAttribute('aria-expanded', String(isOpen));
				return;
			}

			const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
			menuButton.setAttribute('aria-expanded', String(!isCollapsed));
		});

		profileAvatarUpload?.addEventListener('click', (event) => event.stopPropagation());

		profileMenuButton?.addEventListener('click', () => {
			setProfileDropdownOpen(profileDropdown?.hidden === true);
		});

		profileMenuButton?.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				setProfileDropdownOpen(profileDropdown?.hidden === true);
			}
		});

		notificationsButton?.addEventListener('click', () => {
			setNotificationsOpen(notificationsPanel?.hidden === true);
		});
		notificationsPanel?.addEventListener('click', (event) => {
			const destination = event.target.closest('[data-notification-link]')?.dataset.notificationLink;
			if (destination) window.location.href = destination;
		});

		document.addEventListener('click', (event) => {
			if (!profileDropdown?.hidden && !event.target.closest('.profile-menu')) setProfileDropdownOpen(false);
			if (!notificationsPanel?.hidden && !event.target.closest('.notifications-menu')) setNotificationsOpen(false);
		});

		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				setProfileDropdownOpen(false);
				setNotificationsOpen(false);
			}
		});

		profileImageInput?.addEventListener('change', async (event) => {
			const file = event.target.files?.[0];
			const user = getCurrentUser();
			if (!file || !user) return;
			if (!file.type.startsWith('image/')) {
				showMessage('Please choose a PNG, JPG, or WebP image.', 'error');
				return;
			}
			if (file.size > 5 * 1024 * 1024) {
				showMessage('Please choose an image smaller than 5 MB.', 'error');
				return;
			}

			try {
				const imageUrl = await resizeProfileImage(file);
				await setDoc(doc(firestore, 'users', user.uid), {
					photoURL: imageUrl,
					updatedAt: serverTimestamp()
				}, { merge: true });
				renderProfileAvatar(user, imageUrl);
				showMessage('Profile image updated.');
			} catch (error) {
				showMessage('The profile image could not be uploaded.', 'error');
			} finally {
				profileImageInput.value = '';
			}
		});

		viewAllInvoicesButton?.addEventListener('click', () => {
			if (!invoiceRecords.length) {
				showMessage('There are no saved invoices to display yet.');
				return;
			}
			showingAllInvoices = !showingAllInvoices;
			renderInvoiceRows();
			viewAllInvoicesButton.textContent = showingAllInvoices ? 'Show Recent' : 'View All';
			viewAllInvoicesButton.setAttribute('aria-expanded', String(showingAllInvoices));
		});

		viewAllAppointmentsButton?.addEventListener('click', () => {
			if (!appointmentRecords.length) {
				showMessage('There are no saved appointments to display yet.');
				return;
			}
			showingAllAppointments = !showingAllAppointments;
			renderAppointmentRows(appointmentRecords);
			viewAllAppointmentsButton.innerHTML = showingAllAppointments
				? 'Show recent appointments <i class="fa-solid fa-arrow-up"></i>'
				: 'View all appointments <i class="fa-solid fa-arrow-right"></i>';
			viewAllAppointmentsButton.setAttribute('aria-expanded', String(showingAllAppointments));
		});

		periodSelect?.addEventListener('change', renderRevenueChartForPeriod);

		viewCalendarButton?.addEventListener('click', () => {
			calendarDate = new Date();
			showCalendarMonthView();
			renderCalendar();
			if (calendarModal) calendarModal.hidden = false;
			closeCalendarButton?.focus();
		});

		closeCalendarButton?.addEventListener('click', () => {
			if (calendarModal) calendarModal.hidden = true;
			viewCalendarButton?.focus();
		});

		previousMonthButton?.addEventListener('click', () => {
			calendarDate.setMonth(calendarDate.getMonth() - 1);
			renderCalendar();
		});

		nextMonthButton?.addEventListener('click', () => {
			calendarDate.setMonth(calendarDate.getMonth() + 1);
			renderCalendar();
		});

		calendarGrid?.addEventListener('click', (event) => {
			const dayButton = event.target.closest('.calendar-day:not(.empty)');
			if (dayButton?.dataset.date) renderCalendarDayView(dayButton.dataset.date);
		});

		backToMonthButton?.addEventListener('click', () => {
			showCalendarMonthView();
		});

		calendarModal?.addEventListener('click', (event) => {
			if (event.target === calendarModal) closeCalendarButton?.click();
		});

		searchInput?.addEventListener('input', () => {
			const query = searchInput.value.toLowerCase().trim();
			document.querySelectorAll('.table-container tbody tr').forEach((row) => {
				row.hidden = query !== '' && !row.textContent.toLowerCase().includes(query);
			});
		});

		document.addEventListener('keydown', (event) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				searchInput?.focus();
			}
		});

		dashboard.addEventListener('click', (event) => {
			const destination = event.target.closest('[data-dashboard-link]')?.dataset.dashboardLink;
			if (destination) window.location.href = destination;
		});

		document.querySelectorAll('.action-card').forEach((button) => {
			button.addEventListener('click', async () => {
				const user = getCurrentUser();
				if (!user) return;
				const action = button.textContent.trim();
				const quickActions = {
					'Add Customer': ['customers', 'Add Customer', [
						{ name: 'name', label: 'Customer name', required: true },
						{ name: 'email', label: 'Customer email' }
					]],
					'New Appointment': ['bookings', 'New Appointment', [
						{ name: 'customerName', label: 'Customer name', required: true },
						{ name: 'date', label: 'Appointment date', type: 'date', required: true },
						{ name: 'time', label: 'Appointment time', type: 'time', required: true }
					]],
					'Create Invoice': ['invoices', 'Create Invoice', [
						{ name: 'customerName', label: 'Customer name', required: true },
						{ name: 'amount', label: 'Invoice amount', type: 'number', required: true },
						{ name: 'status', label: 'Status', type: 'select', options: ['pending', 'paid', 'overdue'] }
					]],
					'Record Payment': ['payments', 'Record Payment', [
						{ name: 'customerName', label: 'Customer name', required: true },
						{ name: 'amount', label: 'Payment amount', type: 'number', required: true },
						{ name: 'method', label: 'Payment method', type: 'select', options: ['Cash', 'Bank'], required: true },
						{ name: 'status', label: 'Status', type: 'select', options: ['received', 'pending', 'refunded'] }
					]]
				};
				const actionKey = Object.keys(quickActions).find((key) => action.includes(key));
				if (!actionKey) return;
				const [collectionName, title, fields] = quickActions[actionKey];
				try {
					await addRecordFromPrompt(collectionName, title, fields, user);
				} catch (error) {
					showMessage('The record could not be saved to Firestore.', 'error');
				}
			});
		});

		const dateElement = document.querySelector('.date');
		if (dateElement) {
			dateElement.textContent = new Intl.DateTimeFormat('en-ZA', {
				weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
			}).format(new Date());
		}
	}

	const pageShell = document.querySelector('.page-shell');
	if (pageShell) {
		const pageName = document.querySelector('.page-title')?.textContent.trim().toLowerCase() || '';
		const pageCollections = {
			customers: 'customers',
			appointments: 'bookings',
			invoices: 'invoices',
			expenses: 'expenses',
			payments: 'payments'
		};
		const collectionName = pageCollections[pageName];
		const tableBody = pageShell.querySelector('.table-container tbody');
		const statCards = pageShell.querySelectorAll('.stat-card h2');
		const reportPeriodSelect = pageShell.querySelector('#reportPeriodSelect');
		const pageSearch = pageShell.querySelector('.toolbar-search input');
		let pageRecords = [];
		const genericPaginationContainer = pageShell.querySelector('.pagination:not(#appointmentsPagination)');
		let pageCurrentPage = 1;
		const GENERIC_PAGE_SIZE = 10;
		const profileAvatar = pageShell.closest('.main-content')?.querySelector('#profileAvatar');
		const profileImageInput = pageShell.closest('.main-content')?.querySelector('#profileImageInput');
		const profileMenuButton = pageShell.closest('.main-content')?.querySelector('#profileMenuButton');
		const profileDropdown = pageShell.closest('.main-content')?.querySelector('#profileDropdown');
		const profileDropdownName = pageShell.closest('.main-content')?.querySelector('#profileDropdownName');
		const profileDropdownEmail = pageShell.closest('.main-content')?.querySelector('#profileDropdownEmail');
		const profileAvatarUpload = pageShell.closest('.main-content')?.querySelector('.profile-avatar-upload');

		const profileInitials = (name) => String(name || 'Business Manager').split(' ').filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
		const renderPageProfile = (user, imageUrl = user.photoURL) => {
			const targets = [profileAvatar, pageShell.querySelector('#settingsAvatar')].filter(Boolean);
			targets.forEach((target) => {
				target.textContent = '';
				if (imageUrl) {
					const image = document.createElement('img');
					image.src = imageUrl;
					image.alt = `${user.displayName || user.email || 'Business manager'} profile`;
					target.append(image);
				} else {
					target.textContent = profileInitials(user.displayName || user.email);
				}
			});
		};
		const resizePageProfileImage = (file) => new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const image = new Image();
				image.onload = () => {
					const scale = Math.min(256 / image.width, 256 / image.height, 1);
					const canvas = document.createElement('canvas');
					canvas.width = Math.max(1, Math.round(image.width * scale));
					canvas.height = Math.max(1, Math.round(image.height * scale));
					canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
					resolve(canvas.toDataURL('image/jpeg', 0.82));
				};
				image.onerror = reject;
				image.src = reader.result;
			};
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
		const setProfileMenuOpen = (isOpen) => {
			if (!profileDropdown || !profileMenuButton) return;
			profileDropdown.hidden = !isOpen;
			profileMenuButton.setAttribute('aria-expanded', String(isOpen));
		};

		profileMenuButton?.addEventListener('click', () => setProfileMenuOpen(profileDropdown?.hidden === true));
		profileMenuButton?.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				setProfileMenuOpen(profileDropdown?.hidden === true);
			}
		});
		profileAvatarUpload?.addEventListener('click', (event) => event.stopPropagation());
		profileImageInput?.addEventListener('change', async (event) => {
			const file = event.target.files?.[0];
			const user = getCurrentUser();
			if (!file || !user) return;
			try {
				const imageUrl = await resizePageProfileImage(file);
				await setDoc(doc(firestore, 'users', user.uid), { photoURL: imageUrl, updatedAt: serverTimestamp() }, { merge: true });
				renderPageProfile(user, imageUrl);
				showMessage('Profile image updated.');
			} catch (error) {
				console.error('Failed to save profile image', error);
				showMessage('The profile image could not be uploaded.', 'error');
			} finally {
				profileImageInput.value = '';
			}
		});
		document.addEventListener('click', (event) => {
			if (!profileDropdown?.hidden && !event.target.closest('.profile-menu')) setProfileMenuOpen(false);
		});

		const pageEscape = (value) => String(value ?? '')
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#039;');

		const pageDate = (record) => getFirstRecordDate(record, ['date', 'createdAt', 'issueDate']);
		const periodTotals = (records, getValue) => getPeriodTotals(records, getValue, ['date', 'createdAt', 'issueDate']);

		const pageDateText = (record) => {
			const date = pageDate(record);
			return date ? new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(date) : 'Not set';
		};

		const initials = (value) => String(value || 'Customer').split(' ').filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
		const updatePageTrends = (values) => {
			pageShell.querySelectorAll('.trend').forEach((trend, index) => {
				const change = values[index] ?? 0;
				trend.textContent = `${change > 0 ? '+' : ''}${change}%`;
				trend.classList.toggle('positive', change >= 0);
				trend.classList.toggle('negative', change < 0);
			});
		};

		const clearDemoContent = () => {
			statCards.forEach((card) => { card.textContent = 'Loading...'; });
			if (tableBody) tableBody.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';
			pageShell.querySelectorAll('.service-list').forEach((list) => { list.innerHTML = '<div>Loading...</div>'; });
		};

		const statusClass = (status) => {
			const value = String(status || 'pending').toLowerCase();
			return ['paid', 'received', 'completed', 'approved', 'active'].includes(value) ? 'paid' : ['overdue', 'cancelled', 'canceled', 'refunded', 'inactive'].includes(value) ? 'danger' : 'pending';
		};

		const customersFeature = pageName === 'customers'
			? initCustomersPage({ pageName, tableBody, statCards, pageEscape, initials, statusClass, updatePageTrends })
			: null;


		const appointmentsFeature = pageName === 'appointments'
			? initAppointmentsPage({
				pageName, pageShell, tableBody, statCards, pageEscape, initials, statusClass,
				getRecords: () => pageRecords, getCurrentUser,
				reloadRecords: (user) => loadPageRecords(user), showMessage
			})
			: null;
		const invoicesFeature = pageName === 'invoices'
			? initInvoicesPage({
				pageName, pageShell, tableBody, pageEscape, pageDateText, statusClass, generateNextReferenceId,
				updateFinancialStats: (records) => updateFinancialPageStats(records)
			})
			: null;
		const paymentsFeature = pageName === 'payments'
			? initPaymentsPage({
				pageName, pageShell, tableBody, pageEscape, pageDateText, statusClass, generateNextReferenceId,
				updateFinancialStats: (records) => updateFinancialPageStats(records)
			})
			: null;
		const recordFeature = customersFeature || appointmentsFeature || invoicesFeature || paymentsFeature;

		const renderPageRows = (records = pageRecords) => {
			if (recordFeature?.renderRows) return recordFeature.renderRows(records);
			if (!tableBody || !collectionName) return;
			if (!records.length) {
				tableBody.innerHTML = `<tr><td colspan="8">No ${pageName} found yet.</td></tr>`;
				return;
			}

			if (collectionName === 'expenses') {
				tableBody.innerHTML = records.map((record) => `<tr data-record-id="${record.id}"><td><strong>${pageEscape(record.expenseNumber || record.id)}</strong></td><td>${pageEscape(record.category || 'Other')}</td><td>${pageEscape(pageDateText(record))}</td><td>${pageEscape(record.vendor || record.description || 'Not set')}</td><td>${money(record.amount)}</td><td><span class="status-badge ${statusClass(record.status)}">${pageEscape(record.status || 'Approved')}</span></td><td><button class="view-button" type="button" data-page-action="edit">Edit</button> <button class="view-button" type="button" data-page-action="delete">Delete</button></td></tr>`).join('');
			}
		};


		const updateFinancialPageStats = (records) => {
			const total = sumAmounts(records);
			const paid = sumAmounts(records.filter((record) => ['paid', 'received', 'approved', 'completed'].includes(String(record.status || '').toLowerCase())));
			const pending = sumAmounts(records.filter((record) => String(record.status || '').toLowerCase() === 'pending'));
			if (collectionName) {
				if (statCards[0]) statCards[0].textContent = money(total);
				if (statCards[1]) statCards[1].textContent = money(paid);
				if (statCards[2]) statCards[2].textContent = money(pending);
				if (statCards[3]) statCards[3].textContent = money(total - paid - pending);
				const totals = periodTotals(records, (record) => Number(record.amount || 0));
				const paidTotals = periodTotals(records.filter((record) => ['paid', 'received', 'approved', 'completed'].includes(String(record.status || '').toLowerCase())), (record) => Number(record.amount || 0));
				const pendingTotals = periodTotals(records.filter((record) => String(record.status || '').toLowerCase() === 'pending'), (record) => Number(record.amount || 0));
				updatePageTrends([getPercentageChange(totals.current, totals.previous), getPercentageChange(paidTotals.current, paidTotals.previous), getPercentageChange(pendingTotals.current, pendingTotals.previous), 0]);
			}
		};

		const updatePageStats = () => recordFeature?.updateStats
			? recordFeature.updateStats(pageRecords)
			: updateFinancialPageStats(pageRecords);

		const loadReports = async (user) => {
			const [invoiceSnapshot, expenseSnapshot] = await Promise.all([
				getDocs(query(collection(firestore, 'invoices'), where('ownerId', '==', user.uid))),
				getDocs(query(collection(firestore, 'expenses'), where('ownerId', '==', user.uid)))
			]);
			const selectedPeriod = reportPeriodSelect?.value || 'This Month';
			const reportRange = getDateRange(selectedPeriod);
			const isInSelectedPeriod = (record) => {
				const date = pageDate(record);
				return Boolean(date) && date >= reportRange.start && date < reportRange.end;
			};
			const allPaidInvoices = invoiceSnapshot.docs.map((record) => record.data()).filter(isPaidInvoice);
			const allExpenses = expenseSnapshot.docs.map((record) => record.data());
			const invoices = allPaidInvoices.filter(isInSelectedPeriod);
			const expenses = allExpenses.filter(isInSelectedPeriod);
			const revenue = sumAmounts(invoices);
			const expenseTotal = sumAmounts(expenses);
			const profit = calculateProfit(revenue, expenseTotal);
			const reportValues = [money(revenue), money(expenseTotal), money(profit), revenue ? `${((profit / revenue) * 100).toFixed(1)}%` : '0%'];
			reportValues.forEach((value, index) => { if (statCards[index]) statCards[index].textContent = value; });
			const now = new Date();
			const comparisonRange = selectedPeriod === 'This Year'
				? { start: new Date(now.getFullYear() - 1, 0, 1), end: new Date(now.getFullYear(), 0, 1) }
				: selectedPeriod === 'Last Month'
					? { start: new Date(now.getFullYear(), now.getMonth() - 2, 1), end: new Date(now.getFullYear(), now.getMonth() - 1, 1) }
					: { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 1) };
			const sumForRange = (records, range) => records.reduce((sum, record) => {
				const date = pageDate(record);
				return date && date >= range.start && date < range.end ? sum + Number(record.amount || 0) : sum;
			}, 0);
			const previousRevenue = sumForRange(allPaidInvoices, comparisonRange);
			const previousExpenses = sumForRange(allExpenses, comparisonRange);
			const currentProfit = profit;
			const previousProfit = calculateProfit(previousRevenue, previousExpenses);
			const currentMargin = revenue ? currentProfit / revenue : 0;
			const previousMargin = previousRevenue ? previousProfit / previousRevenue : 0;
			updatePageTrends([
				getPercentageChange(revenue, previousRevenue),
				getPercentageChange(expenseTotal, previousExpenses),
				getPercentageChange(currentProfit, previousProfit),
				getPercentageChange(currentMargin, previousMargin)
			]);
			const reportLine = pageShell.querySelector('.reports-analytics .line-chart polyline');
			const reportYAxis = pageShell.querySelector('.reports-analytics .y-axis');
			if (reportLine) {
				const now = new Date();
				const reportLabels = pageShell.querySelector('.reports-analytics .chart-labels');
				if (reportLabels) reportLabels.innerHTML = Array.from({ length: 8 }, (_, index) => {
					const month = new Date(now.getFullYear(), now.getMonth() - 7 + index, 1);
					return `<span>${new Intl.DateTimeFormat('en-ZA', { month: 'short' }).format(month)}</span>`;
				}).join('');
				const monthlyRevenue = Array.from({ length: 8 }, (_, index) => {
					const month = new Date(now.getFullYear(), now.getMonth() - 7 + index, 1);
					return allPaidInvoices.reduce((sum, invoice) => {
						const date = pageDate(invoice);
						return date && date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear() ? sum + Number(invoice.amount || 0) : sum;
					}, 0);
				});
				const axisMaximum = getNiceAxisMaximum(Math.max(...monthlyRevenue, 0));
				reportLine.setAttribute('points', monthlyRevenue.map((value, index) => `${index * 100},${220 - (value / axisMaximum) * 185}`).join(' '));
				if (reportYAxis) {
					const steps = 4;
					reportYAxis.innerHTML = Array.from({ length: steps + 1 }, (_, index) => `<span>R${formatAxisValue(axisMaximum * (1 - index / steps))}</span>`).join('');
				}
			}
			const serviceList = pageShell.querySelector('.reports-analytics .service-list');
			if (serviceList) {
				const categoryTotals = expenses.reduce((totals, record) => {
					const category = record.category || 'Other';
					totals[category] = (totals[category] || 0) + Number(record.amount || 0);
					return totals;
				}, {});
				const colors = ['blue-dot', 'purple-dot', 'green-dot', 'orange-dot', 'red-dot'];
				const entries = Object.entries(categoryTotals).sort(([, first], [, second]) => second - first).slice(0, 5);
				serviceList.innerHTML = entries.length ? entries.map(([category, total], index) => `<div><span><i class="service-dot ${colors[index]}"></i>${pageEscape(category)}</span><strong>${expenseTotal ? Math.round((total / expenseTotal) * 100) : 0}%</strong></div>`).join('') : '<div>No expense data yet.</div>';
			}
		};

		reportPeriodSelect?.addEventListener('change', () => {
			if (getCurrentUser()) loadReports(getCurrentUser());
		});

		const loadSettings = async (user) => {
			const profileSnapshot = await getDoc(doc(firestore, 'users', user.uid));
			const profileData = profileSnapshot.data() || {};
			const fullName = pageShell.querySelector('#fullName');
			const email = pageShell.querySelector('#email');
			const phone = pageShell.querySelector('#phone');
			const changePictureButton = pageShell.querySelector('#changePictureButton');
			const currentPasswordInput = pageShell.querySelector('#currentPassword');
			const newPasswordInput = pageShell.querySelector('#newPassword');
			const confirmPasswordInput = pageShell.querySelector('#confirmPassword');
			const isPasswordAccount = user.providerData.some((provider) => provider.providerId === 'password');

			if (fullName) fullName.value = profileData.fullName || user.displayName || '';
			if (email) email.value = user.email || profileData.email || '';
			if (phone) phone.value = profileData.phone || '';
			renderPageProfile(user, profileData.photoURL || user.photoURL);

			// "Change Picture" reuses the same hidden file input and upload logic as the
			// header avatar, so there is only one place that resizes and saves photos.
			if (changePictureButton && !changePictureButton.dataset.bound) {
				changePictureButton.dataset.bound = 'true';
				changePictureButton.addEventListener('click', () => profileImageInput?.click());
			}

			const saveButton = pageShell.querySelector('#profileSaveButton');
			if (saveButton && !saveButton.dataset.bound) {
				saveButton.dataset.bound = 'true';
				saveButton.addEventListener('click', async () => {
					try {
						const name = fullName?.value.trim() || '';
						const newEmail = email?.value.trim() || '';

						await updateProfile(user, { displayName: name });

						if (newEmail && newEmail !== user.email) {
							await updateEmail(user, newEmail);
						}

						await setDoc(doc(firestore, 'users', user.uid), {
							fullName: name,
							phone: phone?.value.trim() || '',
							email: getCurrentUser()?.email || newEmail || user.email,
							updatedAt: serverTimestamp()
						}, { merge: true });

						const profile = pageShell.closest('.main-content')?.querySelector('.profile-info strong');
						if (profile) profile.textContent = getFirstDisplayName(name || user.email);

						showMessage('Profile settings saved.');
					} catch (error) {
						console.error('Failed to save settings', error);
						showMessage(getFirebaseErrorMessage(error), 'error');
					}
				});
			}

			const updatePasswordButton = pageShell.querySelector('#updatePasswordButton');
			if (updatePasswordButton && !updatePasswordButton.dataset.bound) {
				updatePasswordButton.dataset.bound = 'true';
				updatePasswordButton.addEventListener('click', async () => {
					if (!isPasswordAccount) {
						showMessage('This account signs in with Google, so there is no password to change here.', 'error');
						return;
					}

					const currentPassword = currentPasswordInput?.value || '';
					const newPassword = newPasswordInput?.value || '';
					const confirmPassword = confirmPasswordInput?.value || '';

					if (!currentPassword || !newPassword || !confirmPassword) {
						showMessage('Fill in all three password fields.', 'error');
						return;
					}
					if (newPassword.length < 12) {
						showMessage('Your new password must be at least 12 characters.', 'error');
						return;
					}
					if (newPassword !== confirmPassword) {
						showMessage('New password and confirmation do not match.', 'error');
						return;
					}

					try {
						const credential = EmailAuthProvider.credential(user.email, currentPassword);
						await reauthenticateWithCredential(user, credential);
						await updatePassword(user, newPassword);
						if (currentPasswordInput) currentPasswordInput.value = '';
						if (newPasswordInput) newPasswordInput.value = '';
						if (confirmPasswordInput) confirmPasswordInput.value = '';
						showMessage('Password updated.');
					} catch (error) {
						console.error('Failed to update password', error);
						showMessage(getFirebaseErrorMessage(error), 'error');
					}
				});
			}
		};

		const loadMessages = async (user) => {
			const conversationList = pageShell.querySelector('.conversation-list');
			const conversationSearch = pageShell.querySelector('#conversationSearch');
			const chatMessages = pageShell.querySelector('#chatMessages');
			const messageInput = pageShell.querySelector('#messageInput');
			const sendButton = pageShell.querySelector('#sendButton');
			const snapshot = await getDocs(query(collection(firestore, 'messages'), where('ownerId', '==', user.uid)));
			const records = snapshot.docs.map((record) => ({ id: record.id, ...record.data() }));
			if (conversationList) conversationList.innerHTML = records.length ? records.map((record) => `<div class="conversation-item active"><div class="conversation-avatar">${pageEscape(initials(record.customerName || 'Customer'))}</div><div class="conversation-meta"><div class="conversation-topline"><span class="conversation-name">${pageEscape(record.customerName || 'Customer')}</span><span class="conversation-time">${pageEscape(pageDateText(record))}</span></div><div class="conversation-preview"><span>${pageEscape(record.text || '')}</span></div></div></div>`).join('') : '<p class="empty-state">No messages yet.</p>';
			if (chatMessages) chatMessages.innerHTML = records.length ? records.map((record) => `<div class="message-row outgoing"><div class="message-bubble">${pageEscape(record.text || '')}</div></div>`).join('') : '<p class="empty-state">No messages yet.</p>';
			const sendMessage = async (event) => {
				event?.preventDefault();
				event?.stopImmediatePropagation();
				const text = messageInput?.value.trim();
				if (!text) return;
				try {
					await addDoc(collection(firestore, 'messages'), { ownerId: user.uid, text, customerName: 'Business contact', createdAt: serverTimestamp() });
					messageInput.value = '';
					await loadMessages(user);
				} catch (error) {
					console.error('Failed to send message', error);
					showMessage('Your message could not be sent.', 'error');
				}
			};
			if (sendButton && messageInput && !sendButton.dataset.bound) {
				sendButton.dataset.bound = 'true';
				sendButton.addEventListener('click', sendMessage, true);
				messageInput.addEventListener('keydown', (event) => {
					if (event.key === 'Enter' && !event.shiftKey) sendMessage(event);
				}, true);
			}
			const composeMessage = async () => {
				const values = await showFormModal({
					title: 'New message',
					submitLabel: 'Send message',
					fields: [
						{ name: 'customerName', label: 'Customer name', defaultValue: 'Business contact', required: true },
						{ name: 'text', label: 'Message', required: true }
					]
				});
				if (!values) return;
				try {
					await addDoc(collection(firestore, 'messages'), { ownerId: user.uid, customerName: values.customerName, text: values.text, createdAt: serverTimestamp() });
					await loadMessages(user);
				} catch (error) {
					console.error('Failed to create message', error);
					showMessage('Your message could not be sent.', 'error');
				}
			};
			[...pageShell.querySelectorAll('.primary-button, [aria-label="Compose message"]')]
				.filter((button) => /new message/i.test(button.textContent) || button.getAttribute('aria-label') === 'Compose message')
				.forEach((button) => {
					if (!button.dataset.bound) {
						button.dataset.bound = 'true';
						button.addEventListener('click', composeMessage, true);
					}
				});
			if (conversationSearch && !conversationSearch.dataset.bound) {
				conversationSearch.dataset.bound = 'true';
				conversationSearch.addEventListener('input', (event) => {
					event.stopImmediatePropagation();
					const search = conversationSearch.value.trim().toLowerCase();
					conversationList?.querySelectorAll('.conversation-item').forEach((item) => {
						item.hidden = Boolean(search) && !item.textContent.toLowerCase().includes(search);
					});
				}, true);
			}
		};

		const recordFieldSets = {
			expenses: (customerHint, existing, generatedId) => [
				{ name: 'expenseNumber', label: 'Expense number', disabled: true, defaultValue: existing.expenseNumber || generatedId },
				{ name: 'description', label: 'Description', required: true },
				{ name: 'category', label: 'Category' },
				{ name: 'vendor', label: 'Vendor' },
				{ name: 'date', label: 'Date', type: 'date' },
				{ name: 'amount', label: 'Amount', type: 'number', required: true },
				{ name: 'status', label: 'Status', type: 'select', options: ['approved', 'pending'] }
			],
		};

		const pageSingularTitles = { expenses: 'Expense' };

		const promptRecord = async (user, existing = {}, isEditing = false) => {
			const customerSnapshot = await getCustomerSnapshot(user);
			const customers = customerSnapshot.docs.map((record) => ({ id: record.id, ...record.data() }));
			const customerHint = customers.length ? `e.g. ${customers.map((customer) => customer.name).join(', ')}` : '';
			let generatedId = null;
			if (!isEditing && recordFeature?.generateNumber) generatedId = await recordFeature.generateNumber(user);
			if (!isEditing && collectionName === 'expenses') generatedId = await generateNextReferenceId('expenses', 'expenseNumber', 'EXP', user);
			const fieldSet = recordFeature?.fields || recordFieldSets[collectionName];
			const fields = typeof fieldSet === 'function' ? fieldSet(customerHint, existing, generatedId) : fieldSet;
			const title = `${isEditing ? 'Edit' : 'Add'} ${recordFeature?.singularTitle || pageSingularTitles[collectionName] || 'Record'}`;
			const values = await showFormModal({ title, fields, values: existing, submitLabel: isEditing ? 'Save changes' : 'Add' });
			if (!values) return null;
			if (values.amount !== undefined) values.amount = Number(values.amount);
			if ('customerName' in values) {
				values.customerId = customers.find((customer) => String(customer.name || '').toLowerCase() === values.customerName.toLowerCase())?.id || '';
			}
			return values;
		};

		const savePageRecord = async (user, recordId = null) => {
			const existing = recordId ? pageRecords.find((record) => record.id === recordId) || {} : {};
			const values = await promptRecord(user, existing, Boolean(recordId));
			if (!values) return;
			try {
				if (recordFeature) {
					await recordFeature.saveRecord(user, values, recordId);
				} else {
					const record = { ...values, ownerId: user.uid, updatedAt: serverTimestamp() };
					if (!recordId) record.createdAt = serverTimestamp();
					await setDoc(recordId ? doc(firestore, collectionName, recordId) : doc(collection(firestore, collectionName)), record, { merge: true });
				}
				showMessage(`${pageName.slice(0, -1)} saved.`);
				await loadPageRecords(user);
			} catch (error) {
				console.error(`Failed to save ${collectionName}`, error);
				showMessage(`The ${pageName.slice(0, -1)} could not be saved.`, 'error');
			}
		};

		const loadPageRecords = async (user) => {
			if (!collectionName) return;
			try {
				const records = recordFeature
					? await recordFeature.getSnapshot(user)
					: await getDocs(query(collection(firestore, collectionName), where('ownerId', '==', user.uid)));
				pageRecords = records.docs.map((record) => ({ id: record.id, ...record.data() }));
				if (appointmentsFeature) {
					appointmentsFeature.refresh();
				} else {
					renderFilteredPageRecords();
					updatePageStats();
					applyPageFilters();
				}
			} catch (error) {
				console.error(`Failed to load ${collectionName}`, error);
				if (tableBody) tableBody.innerHTML = '<tr><td colspan="8">Could not load your data.</td></tr>';
				showMessage(`Your ${pageName} could not be loaded.`, 'error');
			}
		};

		clearDemoContent();
		requireAuthenticatedUser(async (user) => {
			const userProfile = document.querySelector('.profile-info strong');
			if (userProfile) userProfile.textContent = getFirstDisplayName(user.displayName || user.email);
			if (profileDropdownName) profileDropdownName.textContent = user.displayName || 'Business Manager';
			if (profileDropdownEmail) profileDropdownEmail.textContent = user.email || 'Signed-in account';
			const profileDocument = await getUserProfile(user);
			renderPageProfile(user, profileDocument.data()?.photoURL || user.photoURL);
			renderUpgradeCard(profileDocument.data()?.plan === 'pro');
			if (collectionName) await loadPageRecords(user);
			if (collectionName && new URLSearchParams(window.location.search).get('new') === '1') {
				window.history.replaceState({}, '', window.location.pathname);
				await savePageRecord(user);
			}
			if (pageName === 'reports') await loadReports(user);
			if (pageName === 'settings') await loadSettings(user);
			if (pageName === 'messages') await loadMessages(user);
		});

		// The Appointments feature owns its period dropdown and view refresh.
		const pageFilterSelects = Array.from(pageShell.querySelectorAll('.toolbar-select')).filter((select) => select.id !== 'appointmentPeriodFilter');

		const recordMatchesFilters = (record) => recordFeature?.matchesFilters ? recordFeature.matchesFilters(record, pageFilterSelects) : pageFilterSelects.every((select) => {
			const value = select.value;
			if (!value || value === 'all') return true;
			if (select.id === 'expenseCategoryFilter') {
				return String(record.category || '').toLowerCase() === value;
			}
			return true;
		});

		const getFilteredPageRecords = () => {
			const searchValue = pageSearch?.value.toLowerCase().trim() || '';
			return pageRecords.filter((record) => (
				recordMatchesFilters(record)
				&& (searchValue === '' || Object.values(record).join(' ').toLowerCase().includes(searchValue))
			));
		};

		const renderGenericPagination = (records) => {
			if (!genericPaginationContainer) return;
			const pageCount = Math.ceil(records.length / GENERIC_PAGE_SIZE);
			genericPaginationContainer.hidden = pageCount <= 1;
			if (pageCount <= 1) return;
			genericPaginationContainer.innerHTML = Array.from({ length: pageCount }, (_, index) => {
				const page = index + 1;
				return `<button type="button" data-page-number="${page}" class="${page === pageCurrentPage ? 'active' : ''}"${page === pageCurrentPage ? ' aria-current="page"' : ''}>${page}</button>`;
			}).join('');
		};

		const renderFilteredPageRecords = () => {
			if (!collectionName || pageName === 'appointments') return;
			const records = getFilteredPageRecords();
			const pageCount = Math.max(1, Math.ceil(records.length / GENERIC_PAGE_SIZE));
			pageCurrentPage = Math.min(pageCurrentPage, pageCount);
			const start = (pageCurrentPage - 1) * GENERIC_PAGE_SIZE;
			renderPageRows(records.slice(start, start + GENERIC_PAGE_SIZE));
			renderGenericPagination(records);
		};

		const applyPageFilters = () => {
			pageCurrentPage = 1;
			renderFilteredPageRecords();
		};

		const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
		const exportPageRecords = () => {
			if (!collectionName || !pageRecords.length) {
				showMessage(`There are no ${pageName} to export.`, 'error');
				return;
			}
			const searchValue = pageSearch?.value.toLowerCase().trim() || '';
			const records = pageRecords.filter((record) => (
				recordMatchesFilters(record)
				&& (!searchValue || Object.values(record).join(' ').toLowerCase().includes(searchValue))
			));
			const columns = recordFeature?.exportColumns || {
				expenses: [['Expense number', 'expenseNumber'], ['Description', 'description'], ['Category', 'category'], ['Vendor', 'vendor'], ['Date', 'date'], ['Amount', 'amount'], ['Status', 'status']],
			}[collectionName];
			if (!columns) return;
			const csv = [columns.map(([label]) => csvCell(label)).join(','), ...records.map((record) => columns.map(([, field]) => csvCell(record[field])).join(','))].join('\n');
			const objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
			const link = document.createElement('a');
			link.href = objectUrl;
			link.download = `businessboss-${collectionName}-${new Date().toISOString().slice(0, 10)}.csv`;
			link.click();
			window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
			showMessage(`${records.length} ${pageName} exported.`);
		};

		const exportButton = [...pageShell.querySelectorAll('.page-actions .secondary-button')]
			.find((button) => /export|download csv/i.test(button.textContent));
		exportButton?.addEventListener('click', exportPageRecords);

		pageSearch?.addEventListener('input', applyPageFilters);
		pageFilterSelects.forEach((select) => select.addEventListener('change', applyPageFilters));
		pageShell.querySelectorAll('[data-clear-filters]').forEach((button) => {
			button.addEventListener('click', () => {
				if (pageSearch) pageSearch.value = '';
				pageFilterSelects.forEach((select) => { select.value = 'all'; });
				applyPageFilters();
			});
		});
		genericPaginationContainer?.addEventListener('click', (event) => {
			const page = Number(event.target.closest('[data-page-number]')?.dataset.pageNumber);
			if (!page || page === pageCurrentPage) return;
			pageCurrentPage = page;
			renderFilteredPageRecords();
		});


		pageShell.querySelectorAll('.primary-button').forEach((button) => {
			if (recordFeature?.isCreateButton(button) || button.textContent.toLowerCase().includes('add expense')) {
				button.addEventListener('click', () => { if (getCurrentUser() && collectionName) savePageRecord(getCurrentUser()); });
			}
		});

		const supportButton = [...pageShell.querySelectorAll('.primary-button')]
			.find((button) => /contact support/i.test(button.textContent));
		supportButton?.addEventListener('click', () => { window.location.href = 'Contact.html'; });

		tableBody?.addEventListener('click', async (event) => {
			const button = event.target.closest('[data-page-action]');
			if (!button || !getCurrentUser()) return;
			const recordId = button.closest('tr')?.dataset.recordId;
			if (button.dataset.pageAction === 'edit') await savePageRecord(getCurrentUser(), recordId);
		if (button.dataset.pageAction === 'delete' && recordId) {
			const confirmation = await showFormModal({
				title: `Delete ${recordFeature?.singularTitle || pageSingularTitles[collectionName] || 'record'}?`,
				description: 'This action permanently removes the record and cannot be undone.',
				fields: [],
				submitLabel: 'Delete record',
				destructive: true
			});
			if (confirmation === null) return;
			try {
					if (recordFeature) await recordFeature.deleteRecord(recordId);
					else await deleteDoc(doc(firestore, collectionName, recordId));
					await loadPageRecords(getCurrentUser());
				} catch (error) {
					console.error(`Failed to delete ${collectionName}`, error);
					showMessage('The record could not be deleted.', 'error');
				}
			}
		});
	}
});
