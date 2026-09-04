import {
	getApp,
	getApps,
	initializeApp
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import {
	getAuth,
	GoogleAuthProvider,
	onAuthStateChanged,
	signOut,
	signInWithEmailAndPassword,
	signInWithPopup,
	createUserWithEmailAndPassword,
	updateProfile
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import {
	addDoc,
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	getFirestore,
	query,
	serverTimestamp,
	setDoc,
	where
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const firebaseConfig = {
	apiKey: 'AIzaSyCCOdG3HgBJ6-BGxS6nA2iaVBwaaok3YSs',
	authDomain: 'business-boss-1b871.firebaseapp.com',
	projectId: 'business-boss-1b871',
	storageBucket: 'business-boss-1b871.firebasestorage.app',
	messagingSenderId: '583044689706',
	appId: '1:583044689706:web:3496dc433aee05c161f853',
	measurementId: 'G-K6T8RSWBLP'
};

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();

const getFirebaseErrorMessage = (error) => {
	const messages = {
		'auth/email-already-in-use': 'An account already exists for this email.',
		'auth/invalid-credential': 'The email or password is incorrect.',
		'auth/invalid-email': 'Enter a valid email address.',
		'auth/missing-password': 'Enter your password.',
		'auth/weak-password': 'Choose a stronger password.',
		'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
		'auth/popup-blocked': 'Allow popups in your browser to use Google Sign-In.',
		'auth/unauthorized-domain': 'This website domain is not authorized for Firebase Sign-In.'
	};
	return messages[error.code] || 'Something went wrong. Please try again.';
};

document.addEventListener('DOMContentLoaded', () => {
	const showMessage = (message, type = 'success') => {
		let messageElement = document.querySelector('[data-script-message]');

		if (!messageElement) {
			messageElement = document.createElement('p');
			messageElement.dataset.scriptMessage = 'true';
			messageElement.setAttribute('role', 'status');
			messageElement.style.marginTop = '1rem';
			messageElement.style.padding = '0.75rem 1rem';
			messageElement.style.borderRadius = '6px';
			messageElement.style.fontWeight = '600';
			const target = document.querySelector('form') || document.querySelector('main') || document.body;
			target.append(messageElement);
		}

		messageElement.textContent = message;
		messageElement.style.color = type === 'error' ? '#b42318' : '#067647';
		messageElement.style.backgroundColor = type === 'error' ? '#fef3f2' : '#ecfdf3';
	};

	document.querySelectorAll('a[href="#"]').forEach((link) => {
		link.addEventListener('click', (event) => event.preventDefault());
	});

	const learnMoreLink = document.querySelector('.btn-secondary');
	if (learnMoreLink) {
		learnMoreLink.href = 'features.html';
	}

	const signupForm = document.querySelector('.signup-form');
	if (signupForm) {
		const password = signupForm.querySelector('#password');
		const confirmPassword = signupForm.querySelector('#confirm-password');

		const validatePasswords = () => {
			if (!password || !confirmPassword) return true;
			const passwordsMatch = password.value === confirmPassword.value;
			confirmPassword.setCustomValidity(passwordsMatch ? '' : 'Passwords do not match.');
			return passwordsMatch;
		};

		password?.addEventListener('input', validatePasswords);
		confirmPassword?.addEventListener('input', validatePasswords);

		signupForm.addEventListener('submit', async (event) => {
			event.preventDefault();

			if (!validatePasswords()) {
				confirmPassword.reportValidity();
				showMessage('Passwords do not match.', 'error');
				return;
			}

			const formData = new FormData(signupForm);

			try {
				const credentials = await createUserWithEmailAndPassword(
					auth,
					formData.get('email'),
					formData.get('password')
				);
				await updateProfile(credentials.user, { displayName: formData.get('full-name') });
				await setDoc(doc(firestore, 'users', credentials.user.uid), {
					fullName: formData.get('full-name'),
					email: formData.get('email'),
					createdAt: serverTimestamp()
				});
				showMessage('Account created. Redirecting you to login...');
				window.setTimeout(() => { window.location.href = 'login.html'; }, 800);
			} catch (error) {
				showMessage(getFirebaseErrorMessage(error), 'error');
			}
		});
	}

	const loginForm = document.querySelector('.login-container');
	if (loginForm) {
		loginForm.addEventListener('submit', async (event) => {
			event.preventDefault();
			const email = loginForm.querySelector('#email').value.trim();
			const password = loginForm.querySelector('#password').value;

			try {
				await signInWithEmailAndPassword(auth, email, password);
				window.location.href = 'dashboard.html';
			} catch (error) {
				showMessage(getFirebaseErrorMessage(error), 'error');
			}
		});
	}

	document.querySelectorAll('.google-btn').forEach((button) => {
		button.type = 'button';
		button.addEventListener('click', async () => {
			try {
				await signInWithPopup(auth, googleProvider);
				const user = auth.currentUser;
				if (user) {
					await setDoc(doc(firestore, 'users', user.uid), {
						fullName: user.displayName || '',
						email: user.email || '',
						updatedAt: serverTimestamp()
					}, { merge: true });
				}
				window.location.href = 'dashboard.html';
			} catch (error) {
				showMessage(getFirebaseErrorMessage(error), 'error');
			}
		});
	});

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
		const logoutButton = document.querySelector('#logoutButton');
		const viewAllInvoicesButton = document.querySelector('#viewAllInvoicesButton');
		const invoiceTableBody = document.querySelector('#invoiceTableBody');
		const viewCalendarButton = document.querySelector('#viewCalendarButton');
		const calendarModal = document.querySelector('#calendarModal');
		const closeCalendarButton = document.querySelector('#closeCalendarButton');
		const previousMonthButton = document.querySelector('#previousMonthButton');
		const nextMonthButton = document.querySelector('#nextMonthButton');
		const calendarMonthLabel = document.querySelector('#calendarMonthLabel');
		const calendarGrid = document.querySelector('#calendarGrid');
		const profileAvatar = document.querySelector('#profileAvatar');
		const profileImageInput = document.querySelector('#profileImageInput');
		const profileAvatarUpload = document.querySelector('.profile-avatar-upload');
		const profileMenuButton = document.querySelector('#profileMenuButton');
		const profileDropdown = document.querySelector('#profileDropdown');
		const profileDropdownName = document.querySelector('#profileDropdownName');
		const profileDropdownEmail = document.querySelector('#profileDropdownEmail');
		const profileDropdownLogout = document.querySelector('#profileDropdownLogout');
		const revenueChartLine = document.querySelector('#revenueChartLine');
		const revenueChartLabels = document.querySelector('#revenueChartLabels');
		const serviceRevenueTotal = document.querySelector('#serviceRevenueTotal');
		const serviceRevenueList = document.querySelector('#serviceRevenueList');
		const appointmentTableBody = document.querySelector('#appointmentTableBody');
		const viewAllAppointmentsButton = document.querySelector('#viewAllAppointmentsButton');
		const searchInput = document.querySelector('#searchInput');
		const statCards = dashboard.querySelectorAll('.stat-card');
		let bookingsForCalendar = [];
		let calendarDate = new Date();
		let invoiceRecords = [];
		let showingAllInvoices = false;
		let appointmentRecords = [];
		let showingAllAppointments = false;
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

		const getRecordDate = (record, fields = ['createdAt']) => {
			for (const field of fields) {
				const value = record[field];
				if (!value) continue;
				if (typeof value.toDate === 'function') return value.toDate();
				if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
				const date = new Date(value);
				if (!Number.isNaN(date.getTime())) return date;
			}
			return null;
		};

		const getPercentageChange = (current, previous) => {
			if (previous === 0) return current === 0 ? 0 : 100;
			return Math.round(((current - previous) / Math.abs(previous)) * 100);
		};

		const isPaidInvoice = (invoice) => String(invoice.status || '').trim().toLowerCase() === 'paid';

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

		const getPeriodTotals = (records, getValue, dateFields) => {
			const now = new Date();
			const currentMonth = now.getMonth();
			const currentYear = now.getFullYear();
			const previousDate = new Date(currentYear, currentMonth - 1, 1);
			return records.reduce((totals, record) => {
				const date = getRecordDate(record, dateFields);
				if (!date) return totals;
				const value = getValue(record);
				if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) totals.current += value;
				if (date.getMonth() === previousDate.getMonth() && date.getFullYear() === previousDate.getFullYear()) totals.previous += value;
				return totals;
			}, { current: 0, previous: 0 });
		};

		const getDayTotals = (records, getValue, dateFields) => {
			const today = new Date();
			const yesterday = new Date(today);
			yesterday.setDate(today.getDate() - 1);
			const isSameDay = (first, second) => first
				&& first.getFullYear() === second.getFullYear()
				&& first.getMonth() === second.getMonth()
				&& first.getDate() === second.getDate();
			return records.reduce((totals, record) => {
				const date = getRecordDate(record, dateFields);
				if (isSameDay(date, today)) totals.current += getValue(record);
				if (isSameDay(date, yesterday)) totals.previous += getValue(record);
				return totals;
			}, { current: 0, previous: 0 });
		};

		const getMonthlyRevenue = (records) => {
			const paidRecords = records.filter(isPaidInvoice);
			const today = new Date();
			return Array.from({ length: 8 }, (_, index) => {
				const monthDate = new Date(today.getFullYear(), today.getMonth() - 7 + index, 1);
				const total = paidRecords.reduce((sum, invoice) => {
					const date = getRecordDate(invoice, ['createdAt', 'date']);
					return date && date.getMonth() === monthDate.getMonth() && date.getFullYear() === monthDate.getFullYear()
						? sum + Number(invoice.amount || 0)
						: sum;
				}, 0);
				return { date: monthDate, total };
			});
		};

		const renderRevenueAnalytics = (records, expenses) => {
			const paidRecords = records.filter(isPaidInvoice);
			const revenueTotals = getPeriodTotals(paidRecords, (invoice) => Number(invoice.amount || 0), ['createdAt', 'date']);
			const expenseTotals = getPeriodTotals(expenses, (expense) => Number(expense.amount || 0), ['createdAt', 'date']);
			const profit = revenueTotals.current - expenseTotals.current;
			if (dashboard.querySelector('[data-performance-value="revenue"]')) {
				dashboard.querySelector('[data-performance-value="revenue"]').textContent = `R${revenueTotals.current.toLocaleString()}`;
				dashboard.querySelector('[data-performance-value="expenses"]').textContent = `R${expenseTotals.current.toLocaleString()}`;
				dashboard.querySelector('[data-performance-value="profit"]').textContent = `R${profit.toLocaleString()}`;
			}
			if (serviceRevenueTotal) serviceRevenueTotal.textContent = `R${revenueTotals.current.toLocaleString()}`;

			const monthlyRevenue = getMonthlyRevenue(records);
			const maximumRevenue = Math.max(...monthlyRevenue.map((month) => month.total), 1);
			if (revenueChartLine) {
				revenueChartLine.setAttribute('points', monthlyRevenue.map((month, index) => {
					const x = index * 100;
					const y = 220 - (month.total / maximumRevenue) * 185;
					return `${x},${y}`;
				}).join(' '));
			}
			if (revenueChartLabels) {
				revenueChartLabels.innerHTML = monthlyRevenue.map((month) => `<span>${new Intl.DateTimeFormat('en-ZA', { month: 'short' }).format(month.date)}</span>`).join('');
			}

			if (serviceRevenueList) {
				const serviceTotals = paidRecords.reduce((totals, invoice) => {
					const date = getRecordDate(invoice, ['createdAt', 'date']);
					const now = new Date();
					if (!date || date.getMonth() !== now.getMonth() || date.getFullYear() !== now.getFullYear()) return totals;
					const service = invoice.service || invoice.serviceName || invoice.category || 'Other';
					totals[service] = (totals[service] || 0) + Number(invoice.amount || 0);
					return totals;
				}, {});
				const colors = ['blue-dot', 'purple-dot', 'green-dot', 'orange-dot', 'red-dot'];
				const services = Object.entries(serviceTotals).sort(([, first], [, second]) => second - first).slice(0, 5);
				serviceRevenueList.innerHTML = services.length
					? services.map(([service, total], index) => `<div><span><i class="service-dot ${colors[index]}"></i>${escapeHtml(service)}</span><strong>${revenueTotals.current ? Math.round((total / revenueTotals.current) * 100) : 0}%</strong></div>`).join('')
					: '<div><span><i class="service-dot blue-dot"></i>No service data</span><strong>0%</strong></div>';
			}
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
				appointmentTableBody.innerHTML = '<tr><td colspan="5">No appointments found yet.</td></tr>';
				return;
			}
			const sortedRecords = [...records].sort((first, second) => {
				const firstDate = getRecordDate(first, ['date', 'createdAt']);
				const secondDate = getRecordDate(second, ['date', 'createdAt']);
				return (firstDate?.getTime() || 0) - (secondDate?.getTime() || 0);
			});
			const recordsToShow = showingAllAppointments ? sortedRecords : sortedRecords.slice(0, 5);
			appointmentTableBody.innerHTML = recordsToShow.map((booking) => {
				const customerName = booking.customerName || booking.customer || 'Customer';
				const date = getRecordDate(booking, ['date', 'createdAt']);
				const appointmentDate = date ? new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(date) : 'Date not set';
				const appointmentTime = booking.time || appointmentDate;
				const status = String(booking.status || 'Pending');
				return `
					<tr>
						<td>${escapeHtml(appointmentTime)}</td>
						<td><div class="customer"><div class="customer-avatar">${escapeHtml(getInitials(customerName))}</div><span>${escapeHtml(customerName)}</span></div></td>
						<td>${escapeHtml(booking.service || booking.serviceName || 'Appointment')}</td>
						<td><span class="status ${getBookingStatusClass(status)}">${escapeHtml(status)}</span></td>
						<td><button class="view-button" type="button">View Details</button></td>
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
						<td>R${Number(invoice.amount || 0).toLocaleString()}</td>
						<td>${escapeHtml(invoice.dueDate || invoice.date || 'Not set')}</td>
						<td><span class="status ${getInvoiceStatusClass(status)}">${escapeHtml(status)}</span></td>
						<td><button class="view-button" type="button">View</button></td>
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
					`<div class="calendar-day${matchingBookings.length ? ' has-bookings' : ''}"><strong>${day}</strong><span>${bookingText}</span></div>`
				);
			}
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
					getUserRecords('customers', user),
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
				appointmentRecords = bookingData;
				renderAppointmentRows(appointmentRecords);
				const bookingTotals = getDayTotals(bookingData, () => 1, ['date', 'createdAt']);
				const revenueTotals = getPeriodTotals(invoiceData.filter(isPaidInvoice), (invoice) => Number(invoice.amount || 0), ['createdAt', 'date']);
				const expenseTotals = getPeriodTotals(expenseData, (expense) => Number(expense.amount || 0), ['createdAt', 'date']);
				const outstandingRecords = invoiceData.filter((invoice) => String(invoice.status || '').toLowerCase() !== 'paid');
				const outstandingTotals = getPeriodTotals(outstandingRecords, (invoice) => Number(invoice.amount || 0), ['createdAt', 'date']);
				const profitTotals = {
					current: revenueTotals.current - expenseTotals.current,
					previous: revenueTotals.previous - expenseTotals.previous
				};

				if (statCards[0]) statCards[0].querySelector('h2').textContent = customers.size.toLocaleString();
				if (statCards[1]) statCards[1].querySelector('h2').textContent = bookingTotals.current.toLocaleString();
				if (statCards[2]) statCards[2].querySelector('h2').textContent = `R${revenueTotals.current.toLocaleString()}`;
				if (statCards[3]) statCards[3].querySelector('h2').textContent = `R${outstandingTotals.current.toLocaleString()}`;
				if (statCards[4]) statCards[4].querySelector('h2').textContent = `R${expenseTotals.current.toLocaleString()}`;

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

		const addRecordFromPrompt = async (collectionName, fields, user) => {
			const record = {};
			for (const field of fields) {
				const value = window.prompt(field.label);
				if (value === null) return;
				if (field.required && !value.trim()) {
					showMessage(`${field.label} is required.`, 'error');
					return;
				}
				record[field.name] = field.type === 'number' ? Number(value) : value.trim();
			}
			record.ownerId = user.uid;
			record.createdAt = serverTimestamp();
			await addDoc(collection(firestore, collectionName), record);
			showMessage(`${collectionName.slice(0, -1)} saved to Firestore.`);
			await updateDashboardData(user);
		};

		onAuthStateChanged(auth, async (user) => {
			if (!user) {
				window.location.href = 'login.html';
				return;
			}
			const profile = document.querySelector('.profile-info strong');
			if (profile) profile.textContent = user.displayName || user.email;
			if (profileDropdownName) profileDropdownName.textContent = user.displayName || 'Business Manager';
			if (profileDropdownEmail) profileDropdownEmail.textContent = user.email || 'Signed-in account';
			const profileDocument = await getDoc(doc(firestore, 'users', user.uid));
			renderProfileAvatar(user, profileDocument.data()?.photoURL || user.photoURL);
			await updateDashboardData(user);
		});

		menuButton?.addEventListener('click', () => {
			if (window.matchMedia('(max-width: 950px)').matches) {
				const isOpen = sidebar?.classList.toggle('open');
				menuButton.setAttribute('aria-expanded', String(isOpen));
				return;
			}

			const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
			menuButton.setAttribute('aria-expanded', String(!isCollapsed));
		});

		const handleLogout = async () => {
			try {
				await signOut(auth);
				window.location.href = 'login.html';
			} catch (error) {
				showMessage('You could not be logged out. Please try again.', 'error');
			}
		};

		logoutButton?.addEventListener('click', handleLogout);
		profileDropdownLogout?.addEventListener('click', handleLogout);
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

		document.addEventListener('click', (event) => {
			if (!profileDropdown?.hidden && !event.target.closest('.profile-menu')) setProfileDropdownOpen(false);
		});

		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') setProfileDropdownOpen(false);
		});

		profileImageInput?.addEventListener('change', async (event) => {
			const file = event.target.files?.[0];
			const user = auth.currentUser;
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

		viewCalendarButton?.addEventListener('click', () => {
			calendarDate = new Date();
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

		calendarModal?.addEventListener('click', (event) => {
			if (event.target === calendarModal) closeCalendarButton?.click();
		});

		searchInput?.addEventListener('input', () => {
			const query = searchInput.value.toLowerCase().trim();
			document.querySelectorAll('.table-container tbody tr').forEach((row) => {
				row.hidden = query !== '' && !row.textContent.toLowerCase().includes(query);
			});
		});

		document.querySelectorAll('.action-card').forEach((button) => {
			button.addEventListener('click', async () => {
				const user = auth.currentUser;
				if (!user) return;
				const action = button.textContent.trim();
				const actionDetails = action.includes('Add Customer')
					? ['customers', [{ name: 'name', label: 'Customer name', required: true }, { name: 'email', label: 'Customer email' }]]
					: action.includes('New Appointment')
						? ['bookings', [{ name: 'customerName', label: 'Customer name', required: true }, { name: 'date', label: 'Appointment date', required: true }]]
						: action.includes('Create Invoice')
							? ['invoices', [{ name: 'customerName', label: 'Customer name', required: true }, { name: 'amount', label: 'Invoice amount', type: 'number', required: true }, { name: 'status', label: 'Invoice status (paid or pending)', required: true }]]
							: ['expenses', [{ name: 'description', label: 'Expense description', required: true }, { name: 'amount', label: 'Expense amount', type: 'number', required: true }]];
				try {
					await addRecordFromPrompt(actionDetails[0], actionDetails[1], user);
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
		const pageSearch = pageShell.querySelector('.toolbar-search input');
		let pageRecords = [];
		const profileAvatar = pageShell.closest('.main-content')?.querySelector('#profileAvatar');
		const profileImageInput = pageShell.closest('.main-content')?.querySelector('#profileImageInput');
		const profileMenuButton = pageShell.closest('.main-content')?.querySelector('#profileMenuButton');
		const profileDropdown = pageShell.closest('.main-content')?.querySelector('#profileDropdown');
		const profileDropdownName = pageShell.closest('.main-content')?.querySelector('#profileDropdownName');
		const profileDropdownEmail = pageShell.closest('.main-content')?.querySelector('#profileDropdownEmail');
		const profileDropdownLogout = pageShell.closest('.main-content')?.querySelector('#profileDropdownLogout');
		const logoutButton = pageShell.closest('.main-content')?.querySelector('#logoutButton');
		const profileAvatarUpload = pageShell.closest('.main-content')?.querySelector('.profile-avatar-upload');

		const profileInitials = (name) => String(name || 'Business Manager').split(' ').filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
		const renderPageProfile = (user, imageUrl = user.photoURL) => {
			if (!profileAvatar) return;
			profileAvatar.textContent = '';
			if (imageUrl) {
				const image = document.createElement('img');
				image.src = imageUrl;
				image.alt = `${user.displayName || user.email || 'Business manager'} profile`;
				profileAvatar.append(image);
			} else {
				profileAvatar.textContent = profileInitials(user.displayName || user.email);
			}
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
		const handlePageLogout = async () => {
			try {
				await signOut(auth);
				window.location.href = 'login.html';
			} catch (error) {
				console.error('Failed to sign out', error);
				showMessage('You could not be logged out. Please try again.', 'error');
			}
		};

		profileMenuButton?.addEventListener('click', () => setProfileMenuOpen(profileDropdown?.hidden === true));
		profileMenuButton?.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				setProfileMenuOpen(profileDropdown?.hidden === true);
			}
		});
		profileDropdownLogout?.addEventListener('click', handlePageLogout);
		logoutButton?.addEventListener('click', handlePageLogout);
		profileAvatarUpload?.addEventListener('click', (event) => event.stopPropagation());
		profileImageInput?.addEventListener('change', async (event) => {
			const file = event.target.files?.[0];
			const user = auth.currentUser;
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

		const pageDate = (record) => {
			const value = record.date || record.createdAt || record.issueDate;
			if (!value) return null;
			if (typeof value.toDate === 'function') return value.toDate();
			if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
			const parsed = new Date(value);
			return Number.isNaN(parsed.getTime()) ? null : parsed;
		};

		const pageDateText = (record) => {
			const date = pageDate(record);
			return date ? new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(date) : 'Not set';
		};

		const money = (value) => `R${Number(value || 0).toLocaleString()}`;
		const initials = (value) => String(value || 'Customer').split(' ').filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
		const percentageChange = (current, previous) => previous === 0 ? (current === 0 ? 0 : 100) : Math.round(((current - previous) / Math.abs(previous)) * 100);
		const periodTotals = (records, getValue) => {
			const now = new Date();
			const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
			return records.reduce((totals, record) => {
				const date = pageDate(record);
				if (!date) return totals;
				const value = getValue(record);
				if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) totals.current += value;
				if (date.getMonth() === previousMonth.getMonth() && date.getFullYear() === previousMonth.getFullYear()) totals.previous += value;
				return totals;
			}, { current: 0, previous: 0 });
		};
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

		const renderPageRows = () => {
			if (!tableBody || !collectionName) return;
			if (!pageRecords.length) {
				tableBody.innerHTML = `<tr><td colspan="8">No ${pageName} found yet.</td></tr>`;
				return;
			}

			if (collectionName === 'customers') {
				tableBody.innerHTML = pageRecords.map((record) => `<tr data-record-id="${record.id}"><td><div class="customer"><div class="customer-avatar">${pageEscape(initials(record.name))}</div><span>${pageEscape(record.name || 'Customer')}</span></div></td><td>${pageEscape(record.email || 'Not set')}</td><td>${pageEscape(record.phone || 'Not set')}</td><td>${money(record.totalSpent)}</td><td><span class="status-badge ${statusClass(record.status)}">${pageEscape(record.status || 'Active')}</span></td><td><button class="view-button" type="button" data-page-action="edit">Edit</button> <button class="view-button" type="button" data-page-action="delete">Delete</button></td></tr>`).join('');
			} else if (collectionName === 'bookings') {
				tableBody.innerHTML = pageRecords.map((record) => `<tr data-record-id="${record.id}"><td>${pageEscape(record.time || pageDateText(record))}</td><td><div class="customer"><div class="customer-avatar">${pageEscape(initials(record.customerName))}</div><span>${pageEscape(record.customerName || 'Customer')}</span></div></td><td>${pageEscape(record.service || 'Appointment')}</td><td>${pageEscape(record.staff || 'Not assigned')}</td><td><span class="status-badge ${statusClass(record.status)}">${pageEscape(record.status || 'Pending')}</span></td><td><button class="view-button" type="button" data-page-action="edit">Edit</button> <button class="view-button" type="button" data-page-action="delete">Delete</button></td></tr>`).join('');
			} else if (collectionName === 'invoices') {
				tableBody.innerHTML = pageRecords.map((record) => `<tr data-record-id="${record.id}"><td><strong>${pageEscape(record.invoiceNumber || record.id)}</strong></td><td>${pageEscape(record.customerName || 'Customer')}</td><td>${pageEscape(pageDateText({ date: record.issueDate || record.date }))}</td><td>${pageEscape(pageDateText({ date: record.dueDate }))}</td><td>${money(record.amount)}</td><td><span class="status-badge ${statusClass(record.status)}">${pageEscape(record.status || 'Pending')}</span></td><td><button class="view-button" type="button" data-page-action="edit">Edit</button> <button class="view-button" type="button" data-page-action="delete">Delete</button></td></tr>`).join('');
			} else if (collectionName === 'expenses') {
				tableBody.innerHTML = pageRecords.map((record) => `<tr data-record-id="${record.id}"><td><strong>${pageEscape(record.expenseNumber || record.id)}</strong></td><td>${pageEscape(record.category || 'Other')}</td><td>${pageEscape(pageDateText(record))}</td><td>${pageEscape(record.vendor || record.description || 'Not set')}</td><td>${money(record.amount)}</td><td><span class="status-badge ${statusClass(record.status)}">${pageEscape(record.status || 'Approved')}</span></td><td><button class="view-button" type="button" data-page-action="edit">Edit</button> <button class="view-button" type="button" data-page-action="delete">Delete</button></td></tr>`).join('');
			} else if (collectionName === 'payments') {
				tableBody.innerHTML = pageRecords.map((record) => `<tr data-record-id="${record.id}"><td><strong>${pageEscape(record.paymentNumber || record.id)}</strong></td><td>${pageEscape(record.customerName || 'Customer')}</td><td>${pageEscape(record.invoiceNumber || record.invoiceId || 'Not linked')}</td><td>${pageEscape(pageDateText(record))}</td><td>${pageEscape(record.method || 'Not set')}</td><td>${money(record.amount)}</td><td><span class="status-badge ${statusClass(record.status)}">${pageEscape(record.status || 'Received')}</span></td><td><button class="view-button" type="button" data-page-action="edit">Edit</button> <button class="view-button" type="button" data-page-action="delete">Delete</button></td></tr>`).join('');
			}
		};

		const updatePageStats = () => {
			const total = pageRecords.reduce((sum, record) => sum + Number(record.amount || 0), 0);
			const paid = pageRecords.filter((record) => ['paid', 'received', 'approved', 'completed'].includes(String(record.status || '').toLowerCase())).reduce((sum, record) => sum + Number(record.amount || 0), 0);
			const pending = pageRecords.filter((record) => String(record.status || '').toLowerCase() === 'pending').reduce((sum, record) => sum + Number(record.amount || 0), 0);
			if (pageName === 'customers') {
				if (statCards[0]) statCards[0].textContent = pageRecords.length;
				if (statCards[1]) statCards[1].textContent = pageRecords.filter((record) => String(record.status || 'active').toLowerCase() === 'active').length;
				if (statCards[2]) statCards[2].textContent = pageRecords.filter((record) => { const date = pageDate(record); const now = new Date(); return date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear(); }).length;
				if (statCards[3]) statCards[3].textContent = pageRecords.filter((record) => String(record.group || record.type || '').toLowerCase() === 'vip').length;
				if (statCards[4]) statCards[4].textContent = pageRecords.filter((record) => String(record.status || '').toLowerCase() === 'inactive').length;
				const customerTotals = periodTotals(pageRecords, () => 1);
				const newCustomers = pageRecords.filter((record) => { const date = pageDate(record); const now = new Date(); return date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear(); });
				updatePageTrends([percentageChange(customerTotals.current, customerTotals.previous), percentageChange(pageRecords.filter((record) => String(record.status || 'active').toLowerCase() === 'active').length, 0), percentageChange(newCustomers.length, 0), 0, 0]);
			} else if (pageName === 'appointments') {
				if (statCards[0]) statCards[0].textContent = pageRecords.length;
				if (statCards[1]) statCards[1].textContent = pageRecords.filter((record) => String(record.status).toLowerCase() === 'completed').length;
				if (statCards[2]) statCards[2].textContent = pageRecords.filter((record) => String(record.status).toLowerCase() === 'pending').length;
				if (statCards[3]) statCards[3].textContent = pageRecords.filter((record) => ['cancelled', 'canceled'].includes(String(record.status).toLowerCase())).length;
				const bookingTotals = periodTotals(pageRecords, () => 1);
				const completedTotals = periodTotals(pageRecords.filter((record) => String(record.status).toLowerCase() === 'completed'), () => 1);
				const pendingTotals = periodTotals(pageRecords.filter((record) => String(record.status).toLowerCase() === 'pending'), () => 1);
				const cancelledTotals = periodTotals(pageRecords.filter((record) => ['cancelled', 'canceled'].includes(String(record.status).toLowerCase())), () => 1);
				updatePageTrends([percentageChange(bookingTotals.current, bookingTotals.previous), percentageChange(completedTotals.current, completedTotals.previous), percentageChange(pendingTotals.current, pendingTotals.previous), percentageChange(cancelledTotals.current, cancelledTotals.previous)]);
			} else if (collectionName) {
				if (statCards[0]) statCards[0].textContent = money(total);
				if (statCards[1]) statCards[1].textContent = money(paid);
				if (statCards[2]) statCards[2].textContent = money(pending);
				if (statCards[3]) statCards[3].textContent = money(total - paid - pending);
				const totals = periodTotals(pageRecords, (record) => Number(record.amount || 0));
				const paidTotals = periodTotals(pageRecords.filter((record) => ['paid', 'received', 'approved', 'completed'].includes(String(record.status || '').toLowerCase())), (record) => Number(record.amount || 0));
				const pendingTotals = periodTotals(pageRecords.filter((record) => String(record.status || '').toLowerCase() === 'pending'), (record) => Number(record.amount || 0));
				updatePageTrends([percentageChange(totals.current, totals.previous), percentageChange(paidTotals.current, paidTotals.previous), percentageChange(pendingTotals.current, pendingTotals.previous), 0]);
			}
		};

		const loadReports = async (user) => {
			const [invoiceSnapshot, expenseSnapshot] = await Promise.all([
				getDocs(query(collection(firestore, 'invoices'), where('ownerId', '==', user.uid))),
				getDocs(query(collection(firestore, 'expenses'), where('ownerId', '==', user.uid)))
			]);
			const invoices = invoiceSnapshot.docs.map((record) => record.data()).filter(isPaidInvoice);
			const expenses = expenseSnapshot.docs.map((record) => record.data());
			const revenue = invoices.reduce((sum, record) => sum + Number(record.amount || 0), 0);
			const expenseTotal = expenses.reduce((sum, record) => sum + Number(record.amount || 0), 0);
			const profit = revenue - expenseTotal;
			const reportValues = [money(revenue), money(expenseTotal), money(profit), revenue ? `${((profit / revenue) * 100).toFixed(1)}%` : '0%'];
			reportValues.forEach((value, index) => { if (statCards[index]) statCards[index].textContent = value; });
			const revenuePeriods = periodTotals(invoices, (record) => Number(record.amount || 0));
			const expensePeriods = periodTotals(expenses, (record) => Number(record.amount || 0));
			const currentProfit = revenuePeriods.current - expensePeriods.current;
			const previousProfit = revenuePeriods.previous - expensePeriods.previous;
			const currentMargin = revenuePeriods.current ? currentProfit / revenuePeriods.current : 0;
			const previousMargin = revenuePeriods.previous ? previousProfit / revenuePeriods.previous : 0;
			updatePageTrends([
				percentageChange(revenuePeriods.current, revenuePeriods.previous),
				percentageChange(expensePeriods.current, expensePeriods.previous),
				percentageChange(currentProfit, previousProfit),
				percentageChange(currentMargin, previousMargin)
			]);
			const reportLine = pageShell.querySelector('.reports-analytics .line-chart polyline');
			if (reportLine) {
				const now = new Date();
				const monthlyRevenue = Array.from({ length: 8 }, (_, index) => {
					const month = new Date(now.getFullYear(), now.getMonth() - 7 + index, 1);
					return invoices.reduce((sum, invoice) => {
						const date = pageDate(invoice);
						return date && date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear() ? sum + Number(invoice.amount || 0) : sum;
					}, 0);
				});
				const maximum = Math.max(...monthlyRevenue, 1);
				reportLine.setAttribute('points', monthlyRevenue.map((value, index) => `${index * 100},${220 - (value / maximum) * 185}`).join(' '));
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

		const loadSettings = async (user) => {
			const profileSnapshot = await getDoc(doc(firestore, 'users', user.uid));
			const profileData = profileSnapshot.data() || {};
			const fullName = pageShell.querySelector('#fullName');
			const email = pageShell.querySelector('#email');
			const phone = pageShell.querySelector('#phone');
			if (fullName) fullName.value = profileData.fullName || user.displayName || '';
			if (email) email.value = user.email || profileData.email || '';
			if (phone) phone.value = profileData.phone || '';
			const saveButton = pageShell.querySelector('#profileSaveButton') || pageShell.querySelector('.settings-actions .primary-button');
			if (saveButton && !saveButton.dataset.bound) {
				saveButton.dataset.bound = 'true';
				saveButton.addEventListener('click', async () => {
					try {
						const name = fullName?.value.trim() || '';
						await updateProfile(user, { displayName: name });
						await setDoc(doc(firestore, 'users', user.uid), { fullName: name, phone: phone?.value.trim() || '', email: user.email, updatedAt: serverTimestamp() }, { merge: true });
						showMessage('Profile settings saved.');
					} catch (error) {
						console.error('Failed to save settings', error);
						showMessage('Your settings could not be saved.', 'error');
					}
				});
			}
		};

		const loadMessages = async (user) => {
			const conversationList = pageShell.querySelector('.conversation-list');
			const chatMessages = pageShell.querySelector('#chatMessages');
			const messageInput = pageShell.querySelector('#messageInput');
			const sendButton = pageShell.querySelector('#sendButton');
			const snapshot = await getDocs(query(collection(firestore, 'messages'), where('ownerId', '==', user.uid)));
			const records = snapshot.docs.map((record) => ({ id: record.id, ...record.data() }));
			if (conversationList) conversationList.innerHTML = records.length ? records.map((record) => `<div class="conversation-item active"><div class="conversation-avatar">${pageEscape(initials(record.customerName || 'Customer'))}</div><div class="conversation-meta"><div class="conversation-topline"><span class="conversation-name">${pageEscape(record.customerName || 'Customer')}</span><span class="conversation-time">${pageEscape(pageDateText(record))}</span></div><div class="conversation-preview"><span>${pageEscape(record.text || '')}</span></div></div></div>`).join('') : '<p class="empty-state">No messages yet.</p>';
			if (chatMessages) chatMessages.innerHTML = records.length ? records.map((record) => `<div class="message-row outgoing"><div class="message-bubble">${pageEscape(record.text || '')}</div></div>`).join('') : '<p class="empty-state">No messages yet.</p>';
			if (sendButton && messageInput && !sendButton.dataset.bound) {
				sendButton.dataset.bound = 'true';
				sendButton.addEventListener('click', async () => {
					const text = messageInput.value.trim();
					if (!text) return;
					await addDoc(collection(firestore, 'messages'), { ownerId: user.uid, text, customerName: 'Business contact', createdAt: serverTimestamp() });
					messageInput.value = '';
					await loadMessages(user);
				});
			}
		};

		const promptRecord = async (user, existing = {}) => {
			const customerSnapshot = await getDocs(query(collection(firestore, 'customers'), where('ownerId', '==', user.uid)));
			const customers = customerSnapshot.docs.map((record) => ({ id: record.id, ...record.data() }));
			const customerHint = customers.length ? ` (available: ${customers.map((customer) => customer.name).join(', ')})` : '';
			if (collectionName === 'customers') return { name: window.prompt('Customer name', existing.name || ''), email: window.prompt('Customer email', existing.email || ''), phone: window.prompt('Customer phone', existing.phone || ''), status: window.prompt('Status (active or inactive)', existing.status || 'active') };
			if (collectionName === 'bookings') {
				const customerName = window.prompt(`Customer name${customerHint}`, existing.customerName || '');
				return { customerName, customerId: customers.find((customer) => String(customer.name || '').toLowerCase() === String(customerName || '').toLowerCase())?.id || '', date: window.prompt('Booking date (YYYY-MM-DD)', existing.date || ''), time: window.prompt('Booking time', existing.time || ''), service: window.prompt('Service', existing.service || ''), staff: window.prompt('Staff member', existing.staff || ''), status: window.prompt('Status (pending, completed or cancelled)', existing.status || 'pending') };
			}
			if (collectionName === 'invoices') {
				const customerName = window.prompt(`Customer name${customerHint}`, existing.customerName || '');
				return { invoiceNumber: window.prompt('Invoice number', existing.invoiceNumber || `INV-${Date.now()}`), customerName, customerId: customers.find((customer) => String(customer.name || '').toLowerCase() === String(customerName || '').toLowerCase())?.id || '', issueDate: window.prompt('Issue date (YYYY-MM-DD)', existing.issueDate || ''), dueDate: window.prompt('Due date (YYYY-MM-DD)', existing.dueDate || ''), amount: Number(window.prompt('Invoice amount', existing.amount || 0)), status: window.prompt('Status (paid, pending or overdue)', existing.status || 'pending'), service: window.prompt('Service/category', existing.service || '') };
			}
			if (collectionName === 'expenses') return { expenseNumber: window.prompt('Expense number', existing.expenseNumber || `EXP-${Date.now()}`), description: window.prompt('Description', existing.description || ''), category: window.prompt('Category', existing.category || ''), vendor: window.prompt('Vendor', existing.vendor || ''), date: window.prompt('Date (YYYY-MM-DD)', existing.date || ''), amount: Number(window.prompt('Amount', existing.amount || 0)), status: window.prompt('Status', existing.status || 'approved') };
			const customerName = window.prompt(`Customer name${customerHint}`, existing.customerName || '');
			return { paymentNumber: window.prompt('Payment number', existing.paymentNumber || `PMT-${Date.now()}`), customerName, customerId: customers.find((customer) => String(customer.name || '').toLowerCase() === String(customerName || '').toLowerCase())?.id || '', invoiceNumber: window.prompt('Invoice number', existing.invoiceNumber || ''), date: window.prompt('Payment date (YYYY-MM-DD)', existing.date || ''), method: window.prompt('Payment method', existing.method || ''), amount: Number(window.prompt('Amount', existing.amount || 0)), status: window.prompt('Status (received, pending or refunded)', existing.status || 'received') };
		};

		const savePageRecord = async (user, recordId = null) => {
			const values = await promptRecord(user, recordId ? pageRecords.find((record) => record.id === recordId) || {} : {});
			if (Object.values(values).some((value) => value === null)) return;
			if (collectionName === 'customers' && !values.name?.trim()) return showMessage('Customer name is required.', 'error');
			if (collectionName === 'bookings' && (!values.customerName?.trim() || !values.date?.trim())) return showMessage('Customer and booking date are required.', 'error');
			if (collectionName === 'invoices' && (!values.customerName?.trim() || !Number.isFinite(values.amount))) return showMessage('Customer and invoice amount are required.', 'error');
			if (collectionName === 'expenses' && (!values.description?.trim() || !Number.isFinite(values.amount))) return showMessage('Description and expense amount are required.', 'error');
			try {
				const record = { ...values, ownerId: user.uid, updatedAt: serverTimestamp() };
				if (!recordId) record.createdAt = serverTimestamp();
				await setDoc(recordId ? doc(firestore, collectionName, recordId) : doc(collection(firestore, collectionName)), record, { merge: true });
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
				const records = await getDocs(query(collection(firestore, collectionName), where('ownerId', '==', user.uid)));
				pageRecords = records.docs.map((record) => ({ id: record.id, ...record.data() }));
				renderPageRows();
				updatePageStats();
			} catch (error) {
				console.error(`Failed to load ${collectionName}`, error);
				if (tableBody) tableBody.innerHTML = '<tr><td colspan="8">Could not load your data.</td></tr>';
				showMessage(`Your ${pageName} could not be loaded.`, 'error');
			}
		};

		clearDemoContent();
		onAuthStateChanged(auth, async (user) => {
			if (!user) {
				window.location.href = 'login.html';
				return;
			}
			const userProfile = document.querySelector('.profile-info strong');
			if (userProfile) userProfile.textContent = user.displayName || user.email;
			if (profileDropdownName) profileDropdownName.textContent = user.displayName || 'Business Manager';
			if (profileDropdownEmail) profileDropdownEmail.textContent = user.email || 'Signed-in account';
			const profileDocument = await getDoc(doc(firestore, 'users', user.uid));
			renderPageProfile(user, profileDocument.data()?.photoURL || user.photoURL);
			if (collectionName) await loadPageRecords(user);
			if (pageName === 'reports') await loadReports(user);
			if (pageName === 'settings') await loadSettings(user);
			if (pageName === 'messages') await loadMessages(user);
		});

		pageSearch?.addEventListener('input', () => {
			const value = pageSearch.value.toLowerCase().trim();
			tableBody?.querySelectorAll('tr').forEach((row) => { row.hidden = value !== '' && !row.textContent.toLowerCase().includes(value); });
		});

		pageShell.querySelectorAll('.primary-button').forEach((button) => {
			if (button.textContent.toLowerCase().includes('add customer') || button.textContent.toLowerCase().includes('new appointment') || button.textContent.toLowerCase().includes('create invoice') || button.textContent.toLowerCase().includes('add expense') || button.textContent.toLowerCase().includes('record payment')) {
				button.addEventListener('click', () => { if (auth.currentUser && collectionName) savePageRecord(auth.currentUser); });
			}
		});

		tableBody?.addEventListener('click', async (event) => {
			const button = event.target.closest('[data-page-action]');
			if (!button || !auth.currentUser) return;
			const recordId = button.closest('tr')?.dataset.recordId;
			if (button.dataset.pageAction === 'edit') await savePageRecord(auth.currentUser, recordId);
			if (button.dataset.pageAction === 'delete' && recordId && window.confirm('Delete this record?')) {
				try {
					await deleteDoc(doc(firestore, collectionName, recordId));
					await loadPageRecords(auth.currentUser);
				} catch (error) {
					console.error(`Failed to delete ${collectionName}`, error);
					showMessage('The record could not be deleted.', 'error');
				}
			}
		});
	}
});

