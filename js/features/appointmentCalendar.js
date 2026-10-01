import { parseFlexibleDate } from '../utils/dates.js';

export const appointmentDateKey = date => `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Read-only compatibility for sparse legacy bookings. Invalid explicit calendar
// dates must not roll into a different month through JavaScript date overflow.
export const appointmentRecordDate = record => {
    if (!record || typeof record !== 'object') return null;
    for (const field of ['date', 'createdAt', 'issueDate']) {
        const value = record[field];
        if (value === undefined || value === null || value === '') continue;
        try {
            let date;
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                const [year, month, day] = value.split('-').map(Number);
                date = new Date(2000, 0, 1);
                date.setFullYear(year, month - 1, day);
                if (year < 1 || appointmentDateKey(date) !== value) return null;
            } else {
                if (typeof value === 'string' && /^\d{4}-/.test(value)) {
                    // Legacy ISO timestamps may be parsed by the shared helper,
                    // but their date component must also be a real calendar day.
                    if (!/^\d{4}-\d{2}-\d{2}T/.test(value)
                        || !appointmentRecordDate({ date: value.slice(0, 10) })) return null;
                }
                // Only known legacy date representations are accepted.
                if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number'
                    && typeof value?.toDate !== 'function' && typeof value?.seconds !== 'number') continue;
                date = parseFlexibleDate(value);
            }
            if (date instanceof Date && Number.isFinite(date.getTime())) return date;
        } catch { /* An unusable legacy timestamp must not break the page. */ }
    }
    return null;
};

export const isCompletedAppointment = record => String(record?.status || '').toLowerCase() === 'completed';
export const isCancelledAppointment = record => ['cancelled', 'canceled'].includes(String(record?.status || '').toLowerCase());
export const activeAppointments = records => records.filter(record => appointmentRecordDate(record) && !isCompletedAppointment(record));

export const createAppointmentCalendarState = (now = new Date()) => ({
    year: now.getFullYear(), month: now.getMonth(), selectedDay: null
});

export const moveAppointmentMonth = (state, delta) => {
    // Day one avoids Jan 31 -> March when navigating to February.
    const date = new Date(2000, 0, 1);
    date.setFullYear(state.year, state.month + delta, 1);
    return { year: date.getFullYear(), month: date.getMonth(), selectedDay: null };
};

export const appointmentMonth = (records, state) => {
    const first = new Date(2000, 0, 1);
    first.setFullYear(state.year, state.month, 1);
    const last = new Date(first);
    last.setMonth(last.getMonth() + 1, 0);
    const groups = new Map();
    for (const record of activeAppointments(records)) {
        const date = appointmentRecordDate(record);
        if (date.getFullYear() !== state.year || date.getMonth() !== state.month) continue;
        const key = appointmentDateKey(date);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(record);
    }
    return {
        first, firstWeekday: first.getDay(),
        days: Array.from({ length: last.getDate() }, (_, index) => {
            const date = new Date(first);
            date.setDate(index + 1);
            const key = appointmentDateKey(date);
            return { key, day: index + 1, records: groups.get(key) || [] };
        })
    };
};

export const appointmentDaySlots = (records, key) => {
    const slots = Array.from({ length: 10 }, (_, index) => ({ label: `${String(index + 8).padStart(2, '0')}:00`, records: [] }));
    const other = { label: 'Other', records: [] };
    for (const record of activeAppointments(records)) {
        if (appointmentDateKey(appointmentRecordDate(record)) !== key) continue;
        const match = typeof record.time === 'string' && /^(\d{1,2}):([0-5]\d)$/.exec(record.time);
        const hour = match ? Number(match[1]) : -1;
        (hour >= 8 && hour <= 17 ? slots[hour - 8] : other).records.push(record);
    }
    return other.records.length ? [...slots, other] : slots;
};
