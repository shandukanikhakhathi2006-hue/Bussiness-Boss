import { normalizeAppointmentInput } from './appointmentContract.js';

export class AppointmentMutationError extends Error {
    constructor(code = 'APPOINTMENT_MUTATION_FAILED') {
        super('Appointment mutation could not be completed.');
        this.name = 'AppointmentMutationError';
        this.code = code;
    }
}

const requireUid = uid => {
    if (typeof uid !== 'string' || !uid) throw new AppointmentMutationError('UNAUTHENTICATED');
    return uid;
};

/** Builds only the data a browser appointment create may persist. */
export const buildAppointmentCreate = ({ uid, input, timestamp }) => ({
    ownerId: requireUid(uid),
    ...normalizeAppointmentInput(input),
    createdAt: timestamp(),
    updatedAt: timestamp()
});

/** Builds a controlled merge-update projection without legacy/cached metadata. */
export const buildAppointmentUpdate = ({ input, timestamp }) => ({
    ...normalizeAppointmentInput(input),
    updatedAt: timestamp()
});

export const buildAppointmentCompletion = ({ timestamp }) => ({
    status: 'completed',
    completedAt: timestamp(),
    updatedAt: timestamp()
});

export const buildAppointmentCancellation = ({ timestamp }) => ({
    status: 'cancelled',
    updatedAt: timestamp()
});

/** A bounded in-memory guard for repeated clicks and programmatic retries. */
export const createAppointmentInFlightGuard = () => {
    const inFlight = new Set();
    return {
        async run(key, operation) {
            if (inFlight.has(key)) return false;
            inFlight.add(key);
            try {
                await operation();
                return true;
            } finally {
                inFlight.delete(key);
            }
        },
        has: key => inFlight.has(key)
    };
};
