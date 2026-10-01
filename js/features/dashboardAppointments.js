import { appointmentRecordDate, isCancelledAppointment, isCompletedAppointment } from './appointmentCalendar.js';
import { isSameDay } from '../utils/dates.js';

const timeValue = value => {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return Number.MAX_SAFE_INTEGER;
    return Number(match[1]) * 60 + Number(match[2]);
};

export const dashboardTodayAppointments = (records, now = new Date()) => records
    .filter(record => {
        const date = appointmentRecordDate(record);
        return date && isSameDay(date, now);
    });

// Dashboard actionable lists show only pending appointments. Stored cancelled
// and completed records remain untouched for history and the main feature.
export const dashboardUpcomingAppointments = (records, now = new Date()) => records
    .filter(record => {
        const date = appointmentRecordDate(record);
        return date && date >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
            && !isCompletedAppointment(record) && !isCancelledAppointment(record);
    })
    .sort((a, b) => (appointmentRecordDate(a) - appointmentRecordDate(b)) || (timeValue(a.time) - timeValue(b.time)) || String(a.id || '').localeCompare(String(b.id || '')));
