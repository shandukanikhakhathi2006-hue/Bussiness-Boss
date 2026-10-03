import { firestore } from '../firebase/config.js';
import { getDateRange } from '../utils/dates.js';
import { appointmentRecordDate, appointmentDateKey, isCompletedAppointment, isCancelledAppointment, createAppointmentCalendarState, moveAppointmentMonth, appointmentMonth, appointmentDaySlots } from './appointmentCalendar.js';
import { AppointmentMutationError, buildAppointmentCancellation, buildAppointmentCompletion, buildAppointmentCreate, buildAppointmentUpdate, createAppointmentInFlightGuard } from './appointmentCrud.js';
import { appointmentCustomerOptions } from './appointmentCustomers.js';
import { renderTableState } from '../utils/recordTable.js';
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

// One feature instance owns the calendar and period listeners for each page shell.
const pageInstances = new WeakMap();

export const initAppointmentsPage = ({ pageName, pageShell, tableBody, statCards, pageEscape, initials, statusClass, getRecords, getCurrentUser, reloadRecords, showMessage, editRecord }) => {
	if (pageName !== 'appointments') return null;
	if (pageInstances.has(pageShell)) return pageInstances.get(pageShell);
	const pageDate = appointmentRecordDate;

	const appointmentPeriodSelect = pageShell.querySelector('#appointmentPeriodFilter');
	const appointmentsCalendarViewButton = pageShell.querySelector('#appointmentsCalendarViewButton');
	const appointmentsTableView = pageShell.querySelector('#appointmentsTableView');
	const appointmentsCalendarView = pageShell.querySelector('#appointmentsCalendarView');
	const appointmentsCalendarToolbar = pageShell.querySelector('#appointmentsCalendarToolbar');
	const appointmentsCalendarGrid = pageShell.querySelector('#appointmentsCalendarGrid');
	const appointmentsCalendarMonthLabel = pageShell.querySelector('#appointmentsCalendarMonthLabel');
	const appointmentsCalendarDayView = pageShell.querySelector('#appointmentsCalendarDayView');
	const appointmentsCalendarDayViewLabel = pageShell.querySelector('#appointmentsCalendarDayViewLabel');
	const appointmentsCalendarDaySlots = pageShell.querySelector('#appointmentsCalendarDaySlots');
	const appointmentsPrevMonthButton = pageShell.querySelector('#appointmentsPrevMonthButton');
	const appointmentsNextMonthButton = pageShell.querySelector('#appointmentsNextMonthButton');
	const appointmentsBackToMonthButton = pageShell.querySelector('#appointmentsBackToMonthButton');
	const appointmentsPaginationContainer = pageShell.querySelector('#appointmentsPagination');
	const appointmentsResultCount = pageShell.querySelector('[data-record-result-count]');
	const appointmentsPeriodHeading = pageShell.querySelector('#appointmentsPeriodHeading');
	let appointmentsViewMode = 'table';
	let calendarState = createAppointmentCalendarState();
	let appointmentsCurrentPage = 1;
	let appointmentsActiveRecordsCache = [];
	let appointmentsLoadState = 'ready';
	const mutationGuard = createAppointmentInFlightGuard();
	const APPOINTMENTS_PAGE_SIZE = 8;

	// Table and stats follow the period filter; calendar state is independent.
	const APPOINTMENT_PERIOD_LABELS = { today: 'Today', week: 'This Week', month: 'This Month' };
	const APPOINTMENT_EMPTY_TEXT = {
		today: 'No appointments scheduled for today.',
		week: 'No appointments scheduled for this week.',
		month: 'No appointments scheduled for this month.'
	};
	const APPOINTMENT_PERIOD_HEADING = { today: 'Today', week: 'This week', month: 'This month' };
	const getSelectedAppointmentPeriod = () => (appointmentPeriodSelect?.value in APPOINTMENT_PERIOD_LABELS ? appointmentPeriodSelect.value : 'today');
	const getAppointmentPeriodRange = () => getDateRange(APPOINTMENT_PERIOD_LABELS[getSelectedAppointmentPeriod()]);
	const formatAppointmentDate = (record) => {
		const date = pageDate(record);
		return date ? new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(date) : 'Date not set';
	};
	const setCalendarStateMarkup = (target, message, state, includeRetry = false) => {
		if (!target) return;
		target.innerHTML = `<p class="appointments-calendar-state" role="${state === 'error' ? 'alert' : 'status'}">${pageEscape(message)}</p>${includeRetry ? '<button type="button" class="secondary-button" data-appointments-retry>Retry</button>' : ''}`;
	};
	const setCalendarError = (message) => {
		appointmentsLoadState = 'error';
		setCalendarStateMarkup(appointmentsCalendarGrid, message, 'error', true);
		if (calendarState.selectedDay) setCalendarStateMarkup(appointmentsCalendarDaySlots, message, 'error', true);
	};
	const retryCalendarLoad = async (button) => {
		const user = getCurrentUser();
		if (!user || button.disabled) return;
		button.disabled = true;
		try {
			await reloadRecords(user);
		} catch (error) {
			console.error('Failed to retry appointment load', error);
			setCalendarError('Appointments could not be loaded. Please try again.');
		} finally {
			button.disabled = false;
		}
	};

	// Active table policy matches the calendar: completed bookings stay stored.
	const getFilteredAppointments = () => {
		const { start, end } = getAppointmentPeriodRange();
		return getRecords().filter((record) => {
			if (isCompletedAppointment(record)) return false;
			const date = pageDate(record);
			return Boolean(date) && date >= start && date < end;
		});
	};

	const renderAppointmentsPagination = (totalPages) => {
		if (!appointmentsPaginationContainer) return;
		if (totalPages <= 1) {
			appointmentsPaginationContainer.hidden = true;
			appointmentsPaginationContainer.innerHTML = '';
			return;
		}
		appointmentsPaginationContainer.hidden = false;
		appointmentsPaginationContainer.innerHTML = Array.from({ length: totalPages }, (_, index) => index + 1)
			.map((page) => `<button type="button" class="${page === appointmentsCurrentPage ? 'active' : ''}" data-appointments-page="${page}">${page}</button>`)
			.join('');
	};

	const renderAppointmentsTable = (activeRecords) => {
		appointmentsActiveRecordsCache = activeRecords;
		if (!tableBody) return;
		if (appointmentsResultCount) appointmentsResultCount.textContent = `${activeRecords.length} ${activeRecords.length === 1 ? 'appointment' : 'appointments'} shown; completed appointments are hidden.`;
		if (!activeRecords.length) {
			renderTableState(tableBody, { message: APPOINTMENT_EMPTY_TEXT[getSelectedAppointmentPeriod()] });
			renderAppointmentsPagination(0);
			return;
		}
		const timeToMinutes = (time) => {
			const match = String(time || '').match(/^(\d{1,2}):(\d{2})/);
			return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
		};
		const sortedRecords = [...activeRecords].sort((first, second) => (pageDate(first) - pageDate(second)) || (timeToMinutes(first.time) - timeToMinutes(second.time)));
		const totalPages = Math.max(1, Math.ceil(sortedRecords.length / APPOINTMENTS_PAGE_SIZE));
		appointmentsCurrentPage = Math.min(Math.max(appointmentsCurrentPage, 1), totalPages);
		const startIndex = (appointmentsCurrentPage - 1) * APPOINTMENTS_PAGE_SIZE;
		const recordsForPage = sortedRecords.slice(startIndex, startIndex + APPOINTMENTS_PAGE_SIZE);
		tableBody.innerHTML = recordsForPage.map((record) => {
			const customerName = record.customerName || record.customer || 'Customer';
			const status = String(record.status || 'pending');
			const dateTime = `${formatAppointmentDate(record)}${record.time ? ` · ${record.time}` : ''}`;
			const actions = status.toLowerCase() === 'pending'
				? `<button class="view-button" type="button" data-page-action="complete" aria-label="Mark appointment with ${pageEscape(customerName)} done">Done</button><button class="view-button" type="button" data-page-action="cancel" aria-label="Cancel appointment with ${pageEscape(customerName)}">Cancel</button>`
				: '';
			return `<tr data-record-id="${pageEscape(record.id)}"><td><time class="appointment-date-time">${pageEscape(dateTime)}</time></td><td><div class="customer"><div class="customer-avatar" aria-hidden="true">${pageEscape(initials(customerName))}</div><span class="appointment-customer-name">${pageEscape(customerName)}</span></div></td><td class="appointment-service">${pageEscape(record.service || 'Appointment')}</td><td class="appointment-staff">${pageEscape(record.staff || 'Not assigned')}</td><td><span class="status-badge ${statusClass(status)}">${pageEscape(status)}</span></td><td class="appointment-actions">${actions}<button class="view-button" type="button" data-page-action="edit" aria-label="Edit appointment with ${pageEscape(customerName)}">Edit</button><button class="view-button" type="button" data-page-action="delete" aria-label="Delete appointment with ${pageEscape(customerName)}">Delete</button></td></tr>`;
		}).join('');
		renderAppointmentsPagination(totalPages);
	};

	const updateAppointmentsStats = (activeRecords) => {
		const { start, end } = getAppointmentPeriodRange();
		const inSelectedPeriod = (record) => { const date = pageDate(record); return Boolean(date) && date >= start && date < end; };
		const periodRecords = getRecords().filter(inSelectedPeriod);
		const completedInPeriod = periodRecords.filter(isCompletedAppointment);
		const cancelledInPeriod = periodRecords.filter((record) => ['cancelled', 'canceled'].includes(String(record.status || '').toLowerCase()));
		const pendingActive = activeRecords.filter((record) => String(record.status || 'pending').toLowerCase() === 'pending');
		if (statCards[0]) statCards[0].textContent = periodRecords.length;
		if (statCards[1]) statCards[1].textContent = completedInPeriod.length;
		if (statCards[2]) statCards[2].textContent = pendingActive.length;
		if (statCards[3]) statCards[3].textContent = cancelledInPeriod.length;
		const firstStatLabel = statCards[0]?.closest('.stat-card')?.querySelector('p');
		if (firstStatLabel) firstStatLabel.textContent = `${APPOINTMENT_PERIOD_HEADING[getSelectedAppointmentPeriod()]} appointments`;
	};

	// The calendar reads the full owner-scoped cache. No month-specific queries.
	const showAppointmentsCalendarMonthView = () => {
		renderAppointmentsCalendarGrid();
		if (appointmentsCalendarGrid) appointmentsCalendarGrid.hidden = false;
		if (appointmentsCalendarToolbar) appointmentsCalendarToolbar.hidden = false;
		if (appointmentsCalendarDayView) appointmentsCalendarDayView.hidden = true;
	};

	const renderAppointmentsCalendarGrid = () => {
		if (!appointmentsCalendarGrid || !appointmentsCalendarMonthLabel) return;
		if (appointmentsLoadState !== 'ready') {
			setCalendarStateMarkup(
				appointmentsCalendarGrid,
				appointmentsLoadState === 'loading' ? 'Loading appointments…' : 'Appointments could not be loaded.',
				appointmentsLoadState,
				appointmentsLoadState === 'error'
			);
			return;
		}
		const month = appointmentMonth(getRecords(), calendarState);
		appointmentsCalendarMonthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month.first);
		const headings = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
			.map((day) => `<span class="calendar-day-name" aria-label="${day}" title="${day}">${day.slice(0, 3)}</span>`)
			.join('');
		const blanks = '<span class="calendar-day empty" aria-hidden="true"></span>'.repeat(month.firstWeekday);
		const todayKey = appointmentDateKey(new Date());
		const days = month.days.map(({ key, day, records }) => {
			const count = records.length;
			const cancelled = records.filter(isCancelledAppointment).length;
			const selected = calendarState.selectedDay === key;
			const date = appointmentRecordDate({ date: key });
			const dateLabel = date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date) : key;
			const bookingText = count ? `${count} ${count === 1 ? 'appointment' : 'appointments'}${cancelled ? `, ${cancelled} cancelled` : ''}` : 'No appointments';
			const today = key === todayKey;
			return `<button type="button" class="calendar-day${count ? ' has-bookings' : ''}${selected ? ' is-selected' : ''}${today ? ' is-today' : ''}" data-date="${key}" aria-label="${pageEscape(`${dateLabel}. ${bookingText}${selected ? '. Selected' : ''}${today ? '. Today' : ''}`)}" aria-pressed="${selected}"${today ? ' aria-current="date"' : ''}><strong>${day}</strong><span aria-hidden="true">${count || ''}</span></button>`;
		}).join('');
		appointmentsCalendarGrid.innerHTML = headings + blanks + days;
	};

	const appointmentBookingHtml = (record) => {
		const status = String(record.status || 'pending');
		const content = `<strong>${pageEscape(record.time || 'No time set')}</strong><span class="appointment-calendar-customer">${pageEscape(record.customerName || record.customer || 'Customer')}</span>${record.service ? `<span class="appointment-calendar-service">${pageEscape(record.service)}</span>` : ''}<span class="status-badge ${statusClass(status)}">${pageEscape(status)}</span>`;
		// Real bookings have document IDs. Sparse records without one remain readable.
		return typeof record.id === 'string' && record.id
			? `<button type="button" class="calendar-slot-booking" data-calendar-edit="${pageEscape(record.id)}" aria-label="${pageEscape(`Edit appointment: ${record.customerName || 'Customer'}, ${record.time || 'No time set'}`)}">${content}</button>`
			: `<div class="calendar-slot-booking">${content}</div>`;
	};

	const renderAppointmentsCalendarDay = () => {
		if (!appointmentsCalendarDaySlots || !appointmentsCalendarDayViewLabel || !calendarState.selectedDay) return;
		if (appointmentsLoadState !== 'ready') {
			setCalendarStateMarkup(
				appointmentsCalendarDaySlots,
				appointmentsLoadState === 'loading' ? 'Loading appointments…' : 'Appointments could not be loaded.',
				appointmentsLoadState,
				appointmentsLoadState === 'error'
			);
			if (appointmentsCalendarGrid) appointmentsCalendarGrid.hidden = true;
			if (appointmentsCalendarToolbar) appointmentsCalendarToolbar.hidden = true;
			if (appointmentsCalendarDayView) appointmentsCalendarDayView.hidden = false;
			return;
		}
		const date = appointmentRecordDate({ date: calendarState.selectedDay });
		if (!date) return;
		appointmentsCalendarDayViewLabel.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date);
		const bookedSlots = appointmentDaySlots(getRecords(), calendarState.selectedDay).filter((slot) => slot.records.length);
		appointmentsCalendarDaySlots.innerHTML = bookedSlots.length
			? bookedSlots.map((slot) => `<div class="calendar-slot"><span class="calendar-slot-time">${slot.label}</span><div class="calendar-slot-content">${slot.records.map(appointmentBookingHtml).join('')}</div></div>`).join('')
			: '<p class="appointment-day-empty" role="status">No appointments scheduled for this day.</p>';
		if (appointmentsCalendarGrid) appointmentsCalendarGrid.hidden = true;
		if (appointmentsCalendarToolbar) appointmentsCalendarToolbar.hidden = true;
		if (appointmentsCalendarDayView) appointmentsCalendarDayView.hidden = false;
	};

	// CRUD replaces the loaded records, never the selected calendar month/day.
	const refreshAppointmentsView = () => {
		appointmentsLoadState = 'ready';
		const activeRecords = getFilteredAppointments();
		renderAppointmentsTable(activeRecords);
		updateAppointmentsStats(activeRecords);
		renderAppointmentsCalendarGrid();
		if (calendarState.selectedDay) renderAppointmentsCalendarDay();
		if (appointmentsPeriodHeading) appointmentsPeriodHeading.textContent = APPOINTMENT_PERIOD_HEADING[getSelectedAppointmentPeriod()];
	};

	const setLoading = () => {
		appointmentsLoadState = 'loading';
		appointmentsActiveRecordsCache = [];
		renderTableState(tableBody, { message: 'Loading appointments…', state: 'loading' });
		setCalendarStateMarkup(appointmentsCalendarGrid, 'Loading appointments…', 'loading');
		if (calendarState.selectedDay) setCalendarStateMarkup(appointmentsCalendarDaySlots, 'Loading appointments…', 'loading');
	};
	const setError = (message) => setCalendarError(message);

	appointmentPeriodSelect?.addEventListener('change', () => {
		appointmentsCurrentPage = 1;
		refreshAppointmentsView();
	});

	appointmentsPaginationContainer?.addEventListener('click', (event) => {
		const pageButton = event.target.closest('[data-appointments-page]');
		if (!pageButton) return;
		appointmentsCurrentPage = Number(pageButton.dataset.appointmentsPage) || 1;
		renderAppointmentsTable(appointmentsActiveRecordsCache);
	});

	// Toggling changes visibility only; month/day selection survives.
	appointmentsCalendarViewButton?.addEventListener('click', () => {
		appointmentsViewMode = appointmentsViewMode === 'calendar' ? 'table' : 'calendar';
		const showingCalendar = appointmentsViewMode === 'calendar';
		if (appointmentsTableView) appointmentsTableView.hidden = showingCalendar;
		if (appointmentsCalendarView) appointmentsCalendarView.hidden = !showingCalendar;
		appointmentsCalendarViewButton.setAttribute?.('aria-pressed', String(showingCalendar));
		appointmentsCalendarViewButton.innerHTML = showingCalendar
			? '<i class="fa-solid fa-table-list" aria-hidden="true"></i> Table view'
			: '<i class="fa-regular fa-calendar" aria-hidden="true"></i> Calendar view';
		if (showingCalendar) {
			renderAppointmentsCalendarGrid();
			if (calendarState.selectedDay) renderAppointmentsCalendarDay();
			else showAppointmentsCalendarMonthView();
		}
	});

	appointmentsPrevMonthButton?.addEventListener('click', () => {
		calendarState = moveAppointmentMonth(calendarState, -1);
		renderAppointmentsCalendarGrid();
	});
	appointmentsNextMonthButton?.addEventListener('click', () => {
		calendarState = moveAppointmentMonth(calendarState, 1);
		renderAppointmentsCalendarGrid();
	});
	appointmentsCalendarGrid?.addEventListener('click', async (event) => {
		const retryButton = event.target.closest('[data-appointments-retry]');
		if (retryButton) {
			await retryCalendarLoad(retryButton);
			return;
		}
		const dayButton = event.target.closest('.calendar-day:not(.empty)');
		if (!dayButton?.dataset.date) return;
		calendarState = { ...calendarState, selectedDay: dayButton.dataset.date };
		renderAppointmentsCalendarGrid();
		renderAppointmentsCalendarDay();
	});
	appointmentsBackToMonthButton?.addEventListener('click', showAppointmentsCalendarMonthView);
	appointmentsCalendarDaySlots?.addEventListener('click', async (event) => {
		const retryButton = event.target.closest('[data-appointments-retry]');
		if (retryButton) {
			await retryCalendarLoad(retryButton);
			return;
		}
		const button = event.target.closest('[data-calendar-edit]');
		if (!button) return;
		event.stopPropagation();
		const user = getCurrentUser();
		if (!user || !ownedRecord(user, button.dataset.calendarEdit) || button.disabled) return;
		button.disabled = true;
		try { await editRecord(user, button.dataset.calendarEdit); }
		catch (error) { console.error('Failed to open appointment', error); showMessage('The appointment could not be opened.', 'error'); }
		finally { button.disabled = false; }
	});


	const ownedRecord = (user, recordId) => getRecords().find((record) => record.id === recordId && record.ownerId === user?.uid) || null;
	const requirePendingOwnedRecord = (user, recordId) => {
		const record = ownedRecord(user, recordId);
		if (!record || String(record.status || 'pending').toLowerCase() !== 'pending') throw new AppointmentMutationError('APPOINTMENT_NOT_ACTIONABLE');
		return record;
	};
	const runMutation = (key, operation) => mutationGuard.run(key, operation);
	const saveRecord = async (user, values, recordId = null) => {
		if (recordId && !ownedRecord(user, recordId)) throw new AppointmentMutationError('APPOINTMENT_NOT_FOUND');
		const key = recordId ? `edit:${recordId}` : `create:${user?.uid || ''}`;
		const persisted = await runMutation(key, async () => {
			const record = recordId ? buildAppointmentUpdate({ input: values, timestamp: serverTimestamp }) : buildAppointmentCreate({ uid: user?.uid, input: values, timestamp: serverTimestamp });
			await setDoc(recordId ? doc(firestore, 'bookings', recordId) : doc(collection(firestore, 'bookings')), record, { merge: true });
		});
		if (!persisted) throw new AppointmentMutationError('APPOINTMENT_BUSY');
	};
	const completeRecord = async (user, recordId) => {
		requirePendingOwnedRecord(user, recordId);
		const persisted = await runMutation(`complete:${recordId}`, () => setDoc(doc(firestore, 'bookings', recordId), buildAppointmentCompletion({ timestamp: serverTimestamp }), { merge: true }));
		if (!persisted) throw new AppointmentMutationError('APPOINTMENT_BUSY');
	};
	const cancelRecord = async (user, recordId) => {
		requirePendingOwnedRecord(user, recordId);
		const persisted = await runMutation(`cancel:${recordId}`, () => setDoc(doc(firestore, 'bookings', recordId), buildAppointmentCancellation({ timestamp: serverTimestamp }), { merge: true }));
		if (!persisted) throw new AppointmentMutationError('APPOINTMENT_BUSY');
	};
	const deleteRecord = async (user, recordId) => {
		if (!ownedRecord(user, recordId)) throw new AppointmentMutationError('APPOINTMENT_NOT_FOUND');
		const deleted = await runMutation(`delete:${recordId}`, () => deleteDoc(doc(firestore, 'bookings', recordId)));
		if (!deleted) throw new AppointmentMutationError('APPOINTMENT_BUSY');
	};
	tableBody?.addEventListener('click', async (event) => {
		const button = event.target.closest('[data-page-action="complete"]'); if (!button || !getCurrentUser()) return;
		const recordId = button.closest('tr')?.dataset.recordId; if (!recordId) return;
		button.disabled = true;
		try { await completeRecord(getCurrentUser(), recordId); await reloadRecords(getCurrentUser()); showMessage('Appointment marked as done.'); }
		catch (error) { console.error('Failed to complete booking', error); showMessage('The appointment could not be marked as done.', 'error'); }
		finally { button.disabled = false; }
	});
	const feature = {
		singularTitle: 'Appointment',
		fields: (customers = [], existing = {}) => [
			{ name: 'customerId', label: 'Customer', type: 'select', required: true, options: appointmentCustomerOptions(customers, existing.customerId, existing.customerName) },
			{ name: 'date', label: 'Booking date', type: 'date', required: true },
			{ name: 'time', label: 'Booking time', type: 'time', required: true },
			{ name: 'service', label: 'Service' },
			{ name: 'staff', label: 'Staff member' },
			{ name: 'status', label: 'Status', type: 'select', defaultValue: 'pending', options: ['pending', 'completed', 'cancelled'] }
		],
		getSnapshot: (user) => getDocs(query(collection(firestore, 'bookings'), where('ownerId', '==', user.uid))),
		saveRecord,
		completeRecord,
		cancelRecord,
		deleteRecord,
		refresh: refreshAppointmentsView,
		setLoading,
		setError,
		isCreateButton: (button) => button.textContent.toLowerCase().includes('new appointment')
	};
	pageInstances.set(pageShell, feature);
	return feature;
};
