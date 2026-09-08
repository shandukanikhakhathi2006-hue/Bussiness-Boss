// Shared helper: converts a Firestore Timestamp, JS Date, number, or string into a JS Date.
// "YYYY-MM-DD" strings are parsed as a LOCAL date (not UTC) so a booking entered for one day
// never displays as the previous day for visitors in timezones behind UTC.
const parseFlexibleDate = (value) => {
	if (!value) return null;
	if (typeof value.toDate === 'function') return value.toDate();
	if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
	if (typeof value === 'string') {
		const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (dateOnlyMatch) {
			const [, year, month, day] = dateOnlyMatch;
			return new Date(Number(year), Number(month) - 1, Number(day));
		}
	}
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
};


// Shared helper: finds the first usable date among several possible field names on a record.
const getFirstRecordDate = (record, fields) => {
	for (const field of fields) {
		const date = parseFlexibleDate(record[field]);
		if (date) return date;
	}
	return null;
};


// Compares two JS Dates by calendar day using their LOCAL year/month/date components (never
// UTC), so "today" always means the visitor's actual today regardless of timezone offset.
const isSameDay = (first, second) => Boolean(first) && Boolean(second)
	&& first.getFullYear() === second.getFullYear()
	&& first.getMonth() === second.getMonth()
	&& first.getDate() === second.getDate();

// Returns a {start, end} range (end EXCLUSIVE) for a named period, using native Date
// arithmetic so month/year rollovers, leap years, and varying month lengths are handled
// correctly by the JS engine itself — never a fixed day-count addition, never a hard-coded
// month or year, so the same code keeps working correctly in any future year.
const getDateRange = (period) => {
	const now = new Date();
	const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const addDays = (date, days) => { const result = new Date(date); result.setDate(result.getDate() + days); return result; };
	const startOfWeek = (date) => addDays(startOfDay(date), -date.getDay());

	if (period === 'Today') { const start = startOfDay(now); return { start, end: addDays(start, 1) }; }
	if (period === 'Tomorrow') { const start = addDays(startOfDay(now), 1); return { start, end: addDays(start, 1) }; }
	if (period === 'This Week') { const start = startOfWeek(now); return { start, end: addDays(start, 7) }; }
	if (period === 'Next Week') { const start = addDays(startOfWeek(now), 7); return { start, end: addDays(start, 7) }; }
	if (period === 'Last Week') { const start = addDays(startOfWeek(now), -7); return { start, end: addDays(start, 7) }; }
	if (period === 'Next Month') { const start = new Date(now.getFullYear(), now.getMonth() + 1, 1); return { start, end: new Date(now.getFullYear(), now.getMonth() + 2, 1) }; }
	if (period === 'Last Month') { const start = new Date(now.getFullYear(), now.getMonth() - 1, 1); return { start, end: new Date(now.getFullYear(), now.getMonth(), 1) }; }
	if (period === 'This Year') { const start = new Date(now.getFullYear(), 0, 1); return { start, end: new Date(now.getFullYear() + 1, 0, 1) }; }
	// "This Month" and any unrecognized option fall back to the current calendar month.
	const start = new Date(now.getFullYear(), now.getMonth(), 1);
	return { start, end: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
};


// Chooses how a period's chart is bucketed along the x-axis: hourly for a single day, by
// weekday for a week, by day-of-month for a month, or by month for a year.
const getPeriodGranularity = (period) => {
	if (period === 'Today' || period === 'Tomorrow') return 'hour';
	if (period === 'This Week' || period === 'Next Week' || period === 'Last Week') return 'weekday';
	if (period === 'This Year') return 'month';
	return 'day-of-month';
};


export { parseFlexibleDate, getFirstRecordDate, isSameDay, getDateRange, getPeriodGranularity };
