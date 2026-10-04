const text = (value) => typeof value === 'string' ? value.trim() : '';

export const normalizeSettingsProfile = (profile = {}, user = {}) => ({
    fullName: text(profile.fullName) || text(user.displayName),
    email: text(user.email) || text(profile.email),
    phone: text(profile.phone),
    photoURL: text(profile.photoURL) || text(user.photoURL)
});

export const isPasswordAccount = (user = {}) =>
    Array.isArray(user.providerData) && user.providerData.some((provider) => provider?.providerId === 'password');

export const settingsErrorMessage = (error) => {
    const code = String(error?.code || '');
    const messages = {
        'auth/requires-recent-login': 'For your security, sign in again before changing this account detail.',
        'auth/email-already-in-use': 'Another account already uses that email address.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/invalid-credential': 'Your current password is incorrect.',
        'auth/weak-password': 'Choose a stronger password with at least 12 characters.',
        'auth/too-many-requests': 'Too many attempts were made. Please wait a moment before trying again.',
        'auth/network-request-failed': 'We could not reach the service. Check your connection and try again.',
        'permission-denied': 'Your profile could not be updated. Sign in again and try once more.'
    };
    return messages[code] || 'Your settings could not be saved. Please try again.';
};

export const profileInitials = (nameOrEmail) => {
    const value = text(nameOrEmail) || 'Business Manager';
    return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
};
