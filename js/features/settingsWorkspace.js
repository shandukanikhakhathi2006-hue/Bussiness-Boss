import {
    EmailAuthProvider,
    reauthenticateWithCredential,
    updateEmail,
    updatePassword,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import { doc, getDoc, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';
import { firestore } from '../firebase/config.js';
import { requireAuthenticatedUser } from '../firebase/auth.js';
import {
    isPasswordAccount,
    normalizeSettingsProfile,
    profileInitials,
    settingsErrorMessage
} from './settingsWorkspaceState.js';

const renderText = (element, value) => {
    element.textContent = value == null || value === '' ? 'Not recorded' : String(value);
};

const headerDisplayName = (nameOrEmail) => {
    const value = String(nameOrEmail || '').trim();
    if (!value) return 'Business Manager';
    const first = value.split(/\s+/)[0];
    return first.includes('@') ? first.split('@')[0] : first;
};

const renderAvatar = (element, profile) => {
    element.replaceChildren();
    if (profile.photoURL) {
        const image = document.createElement('img');
        image.src = profile.photoURL;
        image.alt = (profile.fullName || profile.email || 'Business manager') + ' profile';
        element.append(image);
        return;
    }
    renderText(element, profileInitials(profile.fullName || profile.email));
};

export const mountSettingsWorkspace = (root, {
    getProfile = (uid) => getDoc(doc(firestore, 'users', uid)),
    saveProfile = (uid, data) => setDoc(doc(firestore, 'users', uid), data, { merge: true })
} = {}) => {
    const profileForm = root.querySelector('[data-settings-profile-form]');
    const securityForm = root.querySelector('[data-settings-security-form]');
    const fullName = root.querySelector('#fullName');
    const email = root.querySelector('#email');
    const phone = root.querySelector('#phone');
    const avatar = root.querySelector('#settingsAvatar');
    const changePicture = root.querySelector('#changePictureButton');
    const pictureInput = document.querySelector('#profileImageInput');
    const profileFeedback = root.querySelector('[data-settings-profile-feedback]');
    const securityFeedback = root.querySelector('[data-settings-security-feedback]');
    const profileSubmit = root.querySelector('[data-settings-profile-submit]');
    const passwordSubmit = root.querySelector('[data-settings-password-submit]');
    const passwordFields = root.querySelector('[data-settings-password-fields]');
    const securityDescription = root.querySelector('[data-settings-security-description]');
    const retry = root.querySelector('[data-settings-retry]');

    let currentUser = null;
    let profile = null;
    let profileSaving = false;
    let passwordSaving = false;

    const setFeedback = (target, message, tone = 'status') => {
        target.setAttribute('role', tone === 'error' ? 'alert' : 'status');
        target.textContent = message || '';
        target.hidden = !message;
    };

    const renderProfile = (nextProfile) => {
        profile = nextProfile;
        fullName.value = profile.fullName;
        email.value = profile.email;
        phone.value = profile.phone;
        renderAvatar(avatar, profile);
    };

    const renderSecurity = (user) => {
        const passwordUser = isPasswordAccount(user);
        passwordFields.hidden = !passwordUser;
        passwordSubmit.hidden = !passwordUser;
        if (passwordUser) {
            renderText(securityDescription, 'Use your current password to set a new password. Choose at least 12 characters.');
            setFeedback(securityFeedback, '');
        } else {
            renderText(securityDescription, 'This account signs in with Google. Manage your password through your Google account.');
            setFeedback(securityFeedback, 'No BusinessBoss password is stored for this sign-in method.');
        }
    };

    const updateHeaderProfile = (user) => {
        const name = document.querySelector('.profile-info strong');
        const menuName = document.querySelector('#profileDropdownName');
        if (name) renderText(name, headerDisplayName(user.displayName || user.email));
        if (menuName) renderText(menuName, user.displayName || user.email);
    };

    const load = async () => {
        if (!currentUser) return;
        root.setAttribute('aria-busy', 'true');
        retry.hidden = true;
        setFeedback(profileFeedback, 'Loading profile…');
        try {
            const snapshot = await getProfile(currentUser.uid);
            renderProfile(normalizeSettingsProfile(snapshot.data() || {}, currentUser));
            setFeedback(profileFeedback, '');
        } catch (error) {
            console.error('Failed to load settings profile', error);
            renderProfile(normalizeSettingsProfile({}, currentUser));
            setFeedback(profileFeedback, 'Your saved profile details could not be loaded. You can retry or save updated details.', 'error');
            retry.hidden = false;
        } finally {
            root.setAttribute('aria-busy', 'false');
        }
    };

    changePicture.addEventListener('click', () => pictureInput?.click());
    retry.addEventListener('click', load);

    profileForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!currentUser || profileSaving || !profileForm.reportValidity()) return;

        const name = fullName.value.trim();
        const requestedEmail = email.value.trim();
        if (!name) {
            setFeedback(profileFeedback, 'Enter your full name.', 'error');
            fullName.focus();
            return;
        }

        profileSaving = true;
        profileSubmit.disabled = true;
        setFeedback(profileFeedback, 'Saving profile…');
        try {
            if (requestedEmail && requestedEmail !== currentUser.email) await updateEmail(currentUser, requestedEmail);
            await updateProfile(currentUser, { displayName: name });
            const saved = {
                fullName: name,
                email: currentUser.email || requestedEmail,
                phone: phone.value.trim(),
                updatedAt: serverTimestamp()
            };
            await saveProfile(currentUser.uid, saved);
            renderProfile(normalizeSettingsProfile({ ...profile, ...saved }, currentUser));
            updateHeaderProfile(currentUser);
            setFeedback(profileFeedback, 'Profile settings saved.');
        } catch (error) {
            console.error('Failed to save profile settings', error);
            setFeedback(profileFeedback, settingsErrorMessage(error), 'error');
        } finally {
            profileSaving = false;
            profileSubmit.disabled = false;
        }
    });

    securityForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!currentUser || passwordSaving || !isPasswordAccount(currentUser)) return;
        if (!securityForm.reportValidity()) return;

        const current = root.querySelector('#currentPassword').value;
        const next = root.querySelector('#newPassword').value;
        const confirmation = root.querySelector('#confirmPassword').value;
        if (next.length < 12) {
            setFeedback(securityFeedback, 'Your new password must be at least 12 characters.', 'error');
            return;
        }
        if (next !== confirmation) {
            setFeedback(securityFeedback, 'New password and confirmation do not match.', 'error');
            return;
        }

        passwordSaving = true;
        passwordSubmit.disabled = true;
        setFeedback(securityFeedback, 'Updating password…');
        try {
            const credential = EmailAuthProvider.credential(currentUser.email, current);
            await reauthenticateWithCredential(currentUser, credential);
            await updatePassword(currentUser, next);
            securityForm.reset();
            setFeedback(securityFeedback, 'Password updated.');
        } catch (error) {
            console.error('Failed to update password', error);
            setFeedback(securityFeedback, settingsErrorMessage(error), 'error');
        } finally {
            passwordSaving = false;
            passwordSubmit.disabled = false;
        }
    });

    return {
        start: async (user) => {
            currentUser = user;
            renderSecurity(user);
            await load();
        },
        reload: load,
        getState: () => ({ profile, profileSaving, passwordSaving })
    };
};

const root = document.querySelector('[data-settings-workspace]');
if (root) {
    const workspace = mountSettingsWorkspace(root);
    requireAuthenticatedUser((user) => workspace.start(user));
}
