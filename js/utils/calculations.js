import { getFirstRecordDate, isSameDay } from './dates.js';

// Shared helper used by both the dashboard page and the other pages (customers, reports, etc.)
// so "paid" is defined once, consistently, in one place.
const isPaidInvoice = (invoice) => String(invoice.status || '').trim().toLowerCase() === 'paid';

// Builds {labels, values} for a chart across [range.start, range.end) at the given
// granularity. Every bucket in the range is included even when empty (value 0), so a period
// with no data renders a flat zero line instead of silently reusing another period's shape.
// Reduces a full name (or an email address, as a fallback) to just its first word, so the
// compact header profile chip stays a consistent width no matter how long someone's full
// name is. The full name still shows in the profile dropdown and on the Settings page.
const buildPeriodSeries = (records, range, granularity, dateFields, getValue) => {
	const buckets = [];
	if (granularity === 'hour') {
		for (let hour = 0; hour < 24; hour += 1) {
			const start = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate(), hour);
			const end = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate(), hour + 1);
			buckets.push({ label: `${String(hour).padStart(2, '0')}:00`, start, end });
		}
	} else if (granularity === 'weekday' || granularity === 'day-of-month') {
		let cursor = new Date(range.start);
		while (cursor < range.end) {
			const end = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
			const label = granularity === 'weekday'
				? new Intl.DateTimeFormat('en-ZA', { weekday: 'short' }).format(cursor)
				: String(cursor.getDate());
			buckets.push({ label, start: new Date(cursor), end });
			cursor = end;
		}
	} else {
		let cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
		while (cursor < range.end) {
			const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
			buckets.push({ label: new Intl.DateTimeFormat('en-ZA', { month: 'short' }).format(cursor), start: new Date(cursor), end });
			cursor = end;
		}
	}
	const values = buckets.map((bucket) => records.reduce((sum, record) => {
		const date = getFirstRecordDate(record, dateFields);
		return date && date >= bucket.start && date < bucket.end ? sum + getValue(record) : sum;
	}, 0));
	// Thin the visible labels to roughly 8 evenly-spaced ticks so a 28-31 day month doesn't
	// cram every single day's label into the same space the old fixed 8-point chart used.
	const labelInterval = Math.max(1, Math.ceil(buckets.length / 8));
	const labels = buckets.map((bucket, index) => (index % labelInterval === 0 || index === buckets.length - 1 ? bucket.label : ''));
	return { labels, values };
};


const getPercentageChange = (current, previous) => {
	if (previous === 0) return current === 0 ? 0 : 100;
	return Math.round(((current - previous) / Math.abs(previous)) * 100);
};


const getPeriodTotals = (records, getValue, dateFields = ['createdAt']) => {
	const now = new Date();
	const currentMonth = now.getMonth();
	const currentYear = now.getFullYear();
	const previousDate = new Date(currentYear, currentMonth - 1, 1);
	return records.reduce((totals, record) => {
		const date = getFirstRecordDate(record, dateFields);
		if (!date) return totals;
		const value = getValue(record);
		if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) totals.current += value;
		if (date.getMonth() === previousDate.getMonth() && date.getFullYear() === previousDate.getFullYear()) totals.previous += value;
		return totals;
	}, { current: 0, previous: 0 });
};


const getDayTotals = (records, getValue, dateFields = ['createdAt']) => {
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);
	return records.reduce((totals, record) => {
		const date = getFirstRecordDate(record, dateFields);
		if (isSameDay(date, today)) totals.current += getValue(record);
		if (isSameDay(date, yesterday)) totals.previous += getValue(record);
		return totals;
	}, { current: 0, previous: 0 });
};


// Shared amount reducer; record filtering remains with each existing caller.
const sumAmounts = (records) => records.reduce((sum, record) => sum + Number(record.amount || 0), 0);

const calculateProfit = (revenue, expenses) => revenue - expenses;

export { isPaidInvoice, buildPeriodSeries, getPercentageChange, getPeriodTotals, getDayTotals, sumAmounts, calculateProfit };
