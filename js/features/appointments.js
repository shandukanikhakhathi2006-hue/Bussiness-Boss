import { firestore } from '../firebase/config.js';
import { getDateRange, getFirstRecordDate } from '../utils/dates.js';
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

// One feature instance owns the calendar and period listeners for each page shell.
const pageInstances = new WeakMap();

export const initAppointmentsPage = ({ pageName, pageShell, tableBody, statCards, pageEscape, initials, statusClass, getRecords, getCurrentUser, reloadRecords, showMessage }) => {
	if (pageName !== 'appointments') return null;
	if (pageInstances.has(pageShell)) return pageInstances.get(pageShell);
	const pageDate = (record) => getFirstRecordDate(record, ['date', 'createdAt', 'issueDate']);

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
	let appointmentsViewMode = 'table';
	let appointmentsCalendarDate = new Date();
	let appointmentsCurrentPage = 1;
	let appointmentsActiveRecordsCache = [];
	const APPOINTMENTS_PAGE_SIZE = 8;

	// ===================== APPOINTMENTS: single source of truth =====================
	// The Today / This Week / This Month dropdown drives everything below: the table,
	// the embedded calendar, the counts, and the empty state all read from the SAME
	// getFilteredAppointments() result, so there is exactly one filtering codepath.
	const APPOINTMENT_PERIOD_LABELS = { today: 'Today', week: 'This Week', month: 'This Month' };
	const APPOINTMENT_EMPTY_TEXT = {
		today: 'No appointments scheduled for today.',
		week: 'No appointments scheduled for this week.',
		month: 'No appointments scheduled for this month.'
	};
	const isCompletedAppointment = (record) => String(record.status || '').toLowerCase() === 'completed';
	const getSelectedAppointmentPeriod = () => (appointmentPeriodSelect?.value in APPOINTMENT_PERIOD_LABELS ? appointmentPeriodSelect.value : 'today');
	const getAppointmentPeriodRange = () => getDateRange(APPOINTMENT_PERIOD_LABELS[getSelectedAppointmentPeriod()]);

	// The one filtering function used by the table, the calendar, the counts, and the
	// empty state. Excludes completed appointments (they stay in Firestore for future
	// history/reporting, they just never appear in these active views) and restricts
	// to whichever range the dropdown currently selects.
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
		if (!activeRecords.length) {
			tableBody.innerHTML = `<tr><td colspan="6">${APPOINTMENT_EMPTY_TEXT[getSelectedAppointmentPeriod()]}</td></tr>`;
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
		tableBody.innerHTML = recordsForPage.map((record) => `<tr data-record-id="${record.id}"><td>${pageEscape(record.time || 'No time set')}</td><td><div class="customer"><div class="customer-avatar">${pageEscape(initials(record.customerName))}</div><span>${pageEscape(record.customerName || 'Customer')}</span></div></td><td>${pageEscape(record.service || 'Appointment')}</td><td>${pageEscape(record.staff || 'Not assigned')}</td><td><span class="status-badge ${statusClass(record.status)}">${pageEscape(record.status || 'Pending')}</span></td><td><label class="done-toggle" title="Mark as attended"><input type="checkbox" data-page-action="done"> Done</label><button class="view-button" type="button" data-page-action="edit">Edit</button> <button class="view-button" type="button" data-page-action="delete">Delete</button></td></tr>`).join('');
		renderAppointmentsPagination(totalPages);
	};

	const updateAppointmentsStats = (activeRecords) => {
		const { start, end } = getAppointmentPeriodRange();
		const inSelectedPeriod = (record) => { const date = pageDate(record); return Boolean(date) && date >= start && date < end; };
		const periodRecords = getRecords().filter(inSelectedPeriod);
		const completedInPeriod = periodRecords.filter(isCompletedAppointment);
		const cancelledInPeriod = periodRecords.filter((record) => ['cancelled', 'canceled'].includes(String(record.status || '').toLowerCase()));
		const pendingActive = activeRecords.filter((record) => !['cancelled', 'canceled'].includes(String(record.status || 'pending').toLowerCase()));
		if (statCards[0]) statCards[0].textContent = activeRecords.length;
		if (statCards[1]) statCards[1].textContent = completedInPeriod.length;
		if (statCards[2]) statCards[2].textContent = pendingActive.length;
		if (statCards[3]) statCards[3].textContent = cancelledInPeriod.length;
		const periodLabelText = { today: "Today's Appointments", week: "This Week's Appointments", month: "This Month's Appointments" }[getSelectedAppointmentPeriod()];
		const firstStatLabel = statCards[0]?.closest('.stat-card')?.querySelector('p');
		if (firstStatLabel) firstStatLabel.textContent = periodLabelText;
	};

	// Embedded calendar (Appointments page). Reuses the same .calendar-toolbar /
	// .calendar-grid / .calendar-day-view markup and CSS as the Dashboard's calendar
	// modal so the two look and behave alike, just inline instead of in a dialog.
	// Always draws the current month grid, but only ever marks/lists appointments
	// that are also in the dropdown-filtered active dataset, so the calendar can never
	// show something the table doesn't.
	const APPOINTMENT_CALENDAR_HOURS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
	const appointmentDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

	const showAppointmentsCalendarMonthView = () => {
		if (appointmentsCalendarGrid) appointmentsCalendarGrid.hidden = false;
		if (appointmentsCalendarToolbar) appointmentsCalendarToolbar.hidden = false;
		if (appointmentsCalendarDayView) appointmentsCalendarDayView.hidden = true;
		if (appointmentsCalendarDaySlots) delete appointmentsCalendarDaySlots.dataset.currentDate;
	};

	const renderAppointmentsCalendarGrid = (activeRecords) => {
		if (!appointmentsCalendarGrid || !appointmentsCalendarMonthLabel) return;
		const year = appointmentsCalendarDate.getFullYear();
		const month = appointmentsCalendarDate.getMonth();
		const firstWeekday = new Date(year, month, 1).getDay();
		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		appointmentsCalendarMonthLabel.textContent = new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(appointmentsCalendarDate);
		appointmentsCalendarGrid.innerHTML = dayNames.map((day) => `<span class="calendar-day-name">${day}</span>`).join('');
		for (let i = 0; i < firstWeekday; i += 1) appointmentsCalendarGrid.insertAdjacentHTML('beforeend', '<span class="calendar-day empty" aria-hidden="true"></span>');
		for (let day = 1; day <= daysInMonth; day += 1) {
			const dateKey = appointmentDateKey(new Date(year, month, day));
			const matching = activeRecords.filter((record) => { const date = pageDate(record); return date && appointmentDateKey(date) === dateKey; });
			const bookingText = matching.length ? `${matching.length} appt${matching.length > 1 ? 's' : ''}` : '';
			appointmentsCalendarGrid.insertAdjacentHTML('beforeend', `<button type="button" class="calendar-day${matching.length ? ' has-bookings' : ''}" data-date="${dateKey}"><strong>${day}</strong><span>${bookingText}</span></button>`);
		}
	};

	const appointmentBookingHtml = (record, fallbackTimeLabel) => `<div class="calendar-slot-booking"><strong>${pageEscape(record.time || fallbackTimeLabel)}</strong> ${pageEscape(record.customerName || 'Customer')}${record.service ? ` &middot; ${pageEscape(record.service)}` : ''}</div>`;

	const renderAppointmentsCalendarDay = (dateKey, activeRecords) => {
		if (!appointmentsCalendarDaySlots || !appointmentsCalendarDayViewLabel) return;
		const [year, month, day] = dateKey.split('-').map(Number);
		appointmentsCalendarDayViewLabel.textContent = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'full' }).format(new Date(year, month - 1, day));
		const dayRecords = activeRecords.filter((record) => { const date = pageDate(record); return date && appointmentDateKey(date) === dateKey; });
		const usedRecordIds = new Set();
		const hourSlotsHtml = APPOINTMENT_CALENDAR_HOURS.map((hour) => {
			const hourNumber = Number(hour.split(':')[0]);
			const slotRecords = dayRecords.filter((record) => Number(String(record.time || '').split(':')[0]) === hourNumber);
			slotRecords.forEach((record) => usedRecordIds.add(record.id));
			const slotContent = slotRecords.length
				? slotRecords.map((record) => appointmentBookingHtml(record, hour)).join('')
				: '<div class="calendar-slot-empty">No appointments</div>';
			return `<div class="calendar-slot"><span class="calendar-slot-time">${hour}</span><div class="calendar-slot-content">${slotContent}</div></div>`;
		});
		// Appointments booked outside the 08:00-17:00 business-hours grid (early
		// morning, evening, or with no parseable time) would otherwise be silently
		// dropped from the day view even though they still count on the month grid —
		// this bucket makes sure every active appointment for the day is visible here.
		const leftoverRecords = dayRecords.filter((record) => !usedRecordIds.has(record.id));
		const leftoverSlotHtml = leftoverRecords.length
			? [`<div class="calendar-slot"><span class="calendar-slot-time">Other</span><div class="calendar-slot-content">${leftoverRecords.map((record) => appointmentBookingHtml(record, 'No time set')).join('')}</div></div>`]
			: [];
		appointmentsCalendarDaySlots.innerHTML = [...hourSlotsHtml, ...leftoverSlotHtml].join('');
		if (appointmentsCalendarGrid) appointmentsCalendarGrid.hidden = true;
		if (appointmentsCalendarToolbar) appointmentsCalendarToolbar.hidden = true;
		if (appointmentsCalendarDayView) appointmentsCalendarDayView.hidden = false;
	};

	// Called on load, on every dropdown change, and after any appointment is marked
	// done — the table, the calendar, and the counts always re-derive from the exact
	// same filtered dataset, so they can never disagree with one another.
	const refreshAppointmentsView = () => {
		const activeRecords = getFilteredAppointments();
		renderAppointmentsTable(activeRecords);
		updateAppointmentsStats(activeRecords);
		renderAppointmentsCalendarGrid(activeRecords);
		const openDateKey = appointmentsCalendarDaySlots?.dataset.currentDate;
		if (openDateKey && appointmentsCalendarDayView && !appointmentsCalendarDayView.hidden) {
			renderAppointmentsCalendarDay(openDateKey, activeRecords);
		}
	};
	// ================== end appointments single source of truth ==================

	// The dropdown is the single source of truth: any change re-derives the table,
	// the calendar, and the counts together from the same filtered dataset.
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

	// Root cause of "Calendar View" navigating away: this used to be a plain
	// window.location.href = 'dashboard.html'. It now toggles the calendar embedded
	// directly on this page (built from the same filtered dataset as the table),
	// matching the Dashboard's own calendar in look and behaviour.
	appointmentsCalendarViewButton?.addEventListener('click', () => {
		appointmentsViewMode = appointmentsViewMode === 'calendar' ? 'table' : 'calendar';
		const showingCalendar = appointmentsViewMode === 'calendar';
		if (appointmentsTableView) appointmentsTableView.hidden = showingCalendar;
		if (appointmentsCalendarView) appointmentsCalendarView.hidden = !showingCalendar;
		appointmentsCalendarViewButton.textContent = showingCalendar ? 'Table View' : 'Calendar View';
		if (showingCalendar) {
			appointmentsCalendarDate = new Date();
			showAppointmentsCalendarMonthView();
			renderAppointmentsCalendarGrid(getFilteredAppointments());
		}
	});

	appointmentsPrevMonthButton?.addEventListener('click', () => {
		appointmentsCalendarDate.setMonth(appointmentsCalendarDate.getMonth() - 1);
		renderAppointmentsCalendarGrid(getFilteredAppointments());
	});
	appointmentsNextMonthButton?.addEventListener('click', () => {
		appointmentsCalendarDate.setMonth(appointmentsCalendarDate.getMonth() + 1);
		renderAppointmentsCalendarGrid(getFilteredAppointments());
	});
	appointmentsCalendarGrid?.addEventListener('click', (event) => {
		const dayButton = event.target.closest('.calendar-day:not(.empty)');
		if (!dayButton?.dataset.date) return;
		if (appointmentsCalendarDaySlots) appointmentsCalendarDaySlots.dataset.currentDate = dayButton.dataset.date;
		renderAppointmentsCalendarDay(dayButton.dataset.date, getFilteredAppointments());
	});
	appointmentsBackToMonthButton?.addEventListener('click', showAppointmentsCalendarMonthView);


	tableBody?.addEventListener('click', async (event) => {
		const button = event.target.closest('[data-page-action="done"]');
		if (!button || !getCurrentUser()) return;
		const recordId = button.closest('tr')?.dataset.recordId;
		if (button.dataset.pageAction === 'done' && recordId) {
			if (!button.checked) return;
			try {
				// Reuses the existing "status" field (never a new/duplicate field) and never
				// deletes the document — completed appointments stay in Firestore for future
				// history/reporting, they just drop out of the active table/calendar/counts.
				await setDoc(doc(firestore, 'bookings', recordId), { status: 'completed', completedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
				showMessage('Appointment marked as done.');
				await reloadRecords(getCurrentUser());
			} catch (error) {
				console.error('Failed to complete bookings', error);
				showMessage('The appointment could not be updated.', 'error');
				button.checked = false;
			}
			return;
		}
	});

	const saveRecord = async (user, values, recordId = null) => {
		const record = {
			customerName: values.customerName, customerId: values.customerId,
			date: values.date, time: values.time, service: values.service,
			staff: values.staff, status: values.status, updatedAt: serverTimestamp()
		};
		if (!recordId) {
			record.ownerId = user.uid;
			record.createdAt = serverTimestamp();
		}
		await setDoc(recordId ? doc(firestore, 'bookings', recordId) : doc(collection(firestore, 'bookings')), record, { merge: true });
	};

	const feature = {
		singularTitle: 'Appointment',
		fields: (customerHint) => [
			{ name: 'customerName', label: 'Customer name', required: true, placeholder: customerHint },
			{ name: 'date', label: 'Booking date', type: 'date', required: true },
			{ name: 'time', label: 'Booking time', type: 'time', required: true },
			{ name: 'service', label: 'Service' },
			{ name: 'staff', label: 'Staff member' },
			{ name: 'status', label: 'Status', type: 'select', options: ['pending', 'completed', 'cancelled'] }
		],
		getSnapshot: (user) => getDocs(query(collection(firestore, 'bookings'), where('ownerId', '==', user.uid))),
		saveRecord,
		deleteRecord: (recordId) => deleteDoc(doc(firestore, 'bookings', recordId)),
		refresh: refreshAppointmentsView,
		isCreateButton: (button) => button.textContent.toLowerCase().includes('new appointment')
	};
	pageInstances.set(pageShell, feature);
	return feature;
};
