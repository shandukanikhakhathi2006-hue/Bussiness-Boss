import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { snapshot } from 'businessboss/server/invoiceDraftBoundary.js';
import { appointmentRepositoryErrorCode, createAppointment, getAppointment, listAppointments, updateAppointment } from 'businessboss/server/appointmentRepository.js';
import { servicesForCurrentEnvironment } from './admin.js';

const codes = { UNAUTHENTICATED: 'unauthenticated', INVALID_REQUEST: 'invalid-argument', INVALID_APPOINTMENT: 'invalid-argument', INVALID_APPOINTMENT_TRANSITION: 'failed-precondition', APPOINTMENT_NOT_FOUND: 'not-found', APPOINTMENT_ALREADY_EXISTS: 'already-exists', APPOINTMENT_INVOICED: 'failed-precondition', APPOINTMENT_NOT_COMPLETED: 'failed-precondition', APPOINTMENT_ALREADY_INVOICED: 'failed-precondition', CUSTOMER_NOT_FOUND: 'not-found', CUSTOMER_ARCHIVED: 'failed-precondition', BUSINESS_ACCESS_DENIED: 'permission-denied', BUSINESS_NOT_FOUND: 'not-found', BUSINESS_INACTIVE: 'failed-precondition', INTERNAL: 'internal' };
const toCallable = error => { const code = appointmentRepositoryErrorCode(error); return new HttpsError(codes[code] || 'internal', code === 'UNAUTHENTICATED' ? 'Sign in again.' : code === 'CUSTOMER_NOT_FOUND' ? 'Customer not found.' : code === 'CUSTOMER_ARCHIVED' ? 'Archived customers cannot be scheduled.' : code === 'APPOINTMENT_NOT_FOUND' ? 'Appointment not found.' : 'Unable to complete the appointment request.', { code }); };
async function verified(request, operation) {
    try {
        if (!request.auth?.uid || typeof request.auth.uid !== 'string' || typeof request.auth.rawToken !== 'string') throw Object.assign(new Error(), { code: 'UNAUTHENTICATED' });
        const { auth, db } = servicesForCurrentEnvironment(); const token = await auth.verifyIdToken(request.auth.rawToken, true).catch(() => null);
        if (!token || token.uid !== request.auth.uid) throw Object.assign(new Error(), { code: 'UNAUTHENTICATED' });
        return await operation({ db, verifiedUid: token.uid, data: snapshot(request.data), FieldValue });
    } catch (error) { throw toCallable(error); }
}
export const handleCreateAppointment = request => verified(request, createAppointment);
export const handleGetAppointment = request => verified(request, getAppointment);
export const handleListAppointments = request => verified(request, listAppointments);
export const handleUpdateAppointment = request => verified(request, updateAppointment);
