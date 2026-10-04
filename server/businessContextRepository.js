import { identity, businessIdValid } from './invoiceDraftBoundary.js';

export const PRODUCTION_PROJECT_ID = 'business-boss-1b871';
const ACTIVE = 'active';
const INACTIVE = 'inactive';
const OWNER = 'owner';

export class BusinessContextError extends Error {
    constructor(code) { super(code); this.name = 'BusinessContextError'; this.code = code; }
}
const fail = code => { throw new BusinessContextError(code); };
const validStatus = value => value === ACTIVE || value === INACTIVE;
const validRole = value => typeof value === 'string' && value === OWNER;

function assertUid(uid) {
    if (!identity(uid) || uid.includes('/')) fail('UNAUTHENTICATED');
}
function assertBusinessId(businessId) {
    if (!businessIdValid(businessId)) fail('INVALID_REQUEST');
}
function businessShape(data) {
    if (!data || !identity(data.ownerId) || !validStatus(data.status)) fail('INTERNAL');
    return data;
}
function memberShape(data, uid) {
    if (!data || !validRole(data.role) || !validStatus(data.status)) fail('BUSINESS_ACCESS_DENIED');
    return data;
}

/**
 * Resolves routing input into trusted tenant context. The supplied business ID
 * is never authority: membership, owner and active status are read from Admin
 * Firestore inside the calling transaction.
 */
export async function resolveTrustedBusinessContext(transaction, db, verifiedUid, businessId) {
    assertUid(verifiedUid); assertBusinessId(businessId);
    const businessRef = db.collection('businesses').doc(businessId);
    const memberRef = businessRef.collection('members').doc(verifiedUid);
    const [businessSnapshot, memberSnapshot] = await transaction.getAll(businessRef, memberRef);
    if (!businessSnapshot.exists) fail('BUSINESS_NOT_FOUND');
    const business = businessShape(businessSnapshot.data());
    const member = memberShape(memberSnapshot.data(), verifiedUid);
    if (business.ownerId !== verifiedUid || member.role !== OWNER) fail('BUSINESS_ACCESS_DENIED');
    if (business.status !== ACTIVE || member.status !== ACTIVE) fail('BUSINESS_INACTIVE');
    return Object.freeze({ businessId, ownerId: business.ownerId, role: member.role, status: business.status });
}

/**
 * Server-only, idempotent initial tenant provisioning. A user profile's
 * defaultBusinessId serializes concurrent first calls; an existing unique owned
 * business is adopted only after its owner and membership are verified.
 */
export async function ensureInitialOwnerBusiness({ db, verifiedUid, FieldValue, makeBusinessRef }) {
    assertUid(verifiedUid);
    if (!db?.runTransaction || !FieldValue?.serverTimestamp) fail('INTERNAL');
    return db.runTransaction(async transaction => {
        const userRef = db.collection('users').doc(verifiedUid);
        const userSnapshot = await transaction.get(userRef);
        const defaultBusinessId = userSnapshot.exists ? userSnapshot.data()?.defaultBusinessId : undefined;
        if (defaultBusinessId !== undefined && !businessIdValid(defaultBusinessId)) fail('BUSINESS_ACCESS_DENIED');

        let businessRef;
        if (defaultBusinessId) {
            businessRef = db.collection('businesses').doc(defaultBusinessId);
            const memberRef = businessRef.collection('members').doc(verifiedUid);
            const [businessSnapshot, memberSnapshot] = await transaction.getAll(businessRef, memberRef);
            if (!businessSnapshot.exists) fail('BUSINESS_NOT_FOUND');
            const business = businessShape(businessSnapshot.data());
            if (business.ownerId !== verifiedUid) fail('BUSINESS_ACCESS_DENIED');
            if (business.status !== ACTIVE) fail('BUSINESS_INACTIVE');
            if (!memberSnapshot.exists) {
                transaction.create(memberRef, { role: OWNER, status: ACTIVE, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
                return Object.freeze({ businessId: defaultBusinessId, ownerId: verifiedUid, role: OWNER, status: ACTIVE });
            }
            const member = memberShape(memberSnapshot.data(), verifiedUid);
            if (member.role !== OWNER) fail('BUSINESS_ACCESS_DENIED');
            if (member.status !== ACTIVE) fail('BUSINESS_INACTIVE');
            return Object.freeze({ businessId: defaultBusinessId, ownerId: verifiedUid, role: OWNER, status: ACTIVE });
        }

        const owned = await transaction.get(db.collection('businesses').where('ownerId', '==', verifiedUid).limit(2));
        if (owned.size > 1) fail('BUSINESS_CONTEXT_CONFLICT');
        if (owned.size === 1) {
            businessRef = owned.docs[0].ref;
            const business = businessShape(owned.docs[0].data());
            if (business.ownerId !== verifiedUid) fail('BUSINESS_ACCESS_DENIED');
            if (business.status !== ACTIVE) fail('BUSINESS_INACTIVE');
            const memberRef = businessRef.collection('members').doc(verifiedUid);
            const memberSnapshot = await transaction.get(memberRef);
            if (!memberSnapshot.exists) {
                transaction.create(memberRef, { role: OWNER, status: ACTIVE, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
            } else {
                const member = memberShape(memberSnapshot.data(), verifiedUid);
                if (member.role !== OWNER) fail('BUSINESS_ACCESS_DENIED');
                if (member.status !== ACTIVE) fail('BUSINESS_INACTIVE');
            }
            transaction.set(userRef, { defaultBusinessId: businessRef.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            return Object.freeze({ businessId: businessRef.id, ownerId: verifiedUid, role: OWNER, status: ACTIVE });
        }

        businessRef = makeBusinessRef ? makeBusinessRef(db) : db.collection('businesses').doc();
        assertBusinessId(businessRef?.id);
        const memberRef = businessRef.collection('members').doc(verifiedUid);
        transaction.create(businessRef, { ownerId: verifiedUid, status: ACTIVE, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        transaction.create(memberRef, { role: OWNER, status: ACTIVE, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        transaction.set(userRef, { defaultBusinessId: businessRef.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return Object.freeze({ businessId: businessRef.id, ownerId: verifiedUid, role: OWNER, status: ACTIVE });
    });
}
