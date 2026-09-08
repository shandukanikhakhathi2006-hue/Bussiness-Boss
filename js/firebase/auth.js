import { auth, firestore } from './config.js';
import {
    GoogleAuthProvider,
    onAuthStateChanged,
    signOut,
    signInWithEmailAndPassword,
    signInWithPopup,
    createUserWithEmailAndPassword,
    updateProfile,
    sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const googleProvider = new GoogleAuthProvider();
const boundElements = new WeakSet();
const authGuards = new WeakMap();

const getFirebaseErrorMessage = (error) => {
    const messages = {
        'auth/email-already-in-use': 'An account already exists for this email.',
        'auth/invalid-credential': 'The email or password is incorrect.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/missing-password': 'Enter your password.',
        'auth/weak-password': 'Choose a stronger password.',
        'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
        'auth/popup-blocked': 'Allow popups in your browser to use Google Sign-In.',
        'auth/unauthorized-domain': 'This website domain is not authorized for Firebase Sign-In.',
        'auth/wrong-password': 'Your current password is incorrect.',
        'auth/missing-password': 'Enter your current password.',
        'auth/requires-recent-login': 'Please log out and log back in, then try again.',
        'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.'
    };
    return messages[error.code] || 'Something went wrong. Please try again.';
};

const getCurrentUser = () => auth.currentUser;
const getUserProfile = (user) => getDoc(doc(firestore, 'users', user.uid));
const loginWithEmail = (email, password) => signInWithEmailAndPassword(auth, email, password);
const sendPasswordReset = (email) => sendPasswordResetEmail(auth, email);

const registerWithEmail = async (fullName, email, password) => {
    const credentials = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credentials.user, { displayName: fullName });
    await setDoc(doc(firestore, 'users', credentials.user.uid), {
        fullName,
        email,
        createdAt: serverTimestamp()
    });
    return credentials;
};

const loginWithGoogle = async () => {
    const credentials = await signInWithPopup(auth, googleProvider);
    const user = getCurrentUser();
    if (user) {
        const userDocRef = doc(firestore, 'users', user.uid);
        const existingProfile = await getUserProfile(user);
        await setDoc(userDocRef, {
            fullName: user.displayName || '',
            email: user.email || '',
            ...(existingProfile.exists() ? {} : { createdAt: serverTimestamp() }),
            updatedAt: serverTimestamp()
        }, { merge: true });
    }
    return credentials;
};

const logoutUser = async () => {
    await signOut(auth);
    window.location.href = 'login.html';
};

// Each protected page registers its existing controller callback once. Repeated
// registration of that same callback reuses the subscription; callers can unsubscribe.
const requireAuthenticatedUser = (callback) => {
    if (authGuards.has(callback)) return authGuards.get(callback);
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        await callback(user);
    });
    const stop = () => {
        unsubscribe();
        authGuards.delete(callback);
    };
    authGuards.set(callback, stop);
    return stop;
};

// Called after DOMContentLoaded. Only handlers whose elements exist are installed.
// Feedback is supplied by the controller, so this module never imports script.js.
const initAuthPages = (showMessage) => {
    const signupForm = document.querySelector('.signup-form');
    if (signupForm && !boundElements.has(signupForm)) {
        boundElements.add(signupForm);
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
                await registerWithEmail(formData.get('full-name'), formData.get('email'), formData.get('password'));
                showMessage('Account created. Redirecting you to login...');
                window.setTimeout(() => { window.location.href = 'login.html'; }, 800);
            } catch (error) {
                showMessage(getFirebaseErrorMessage(error), 'error');
            }
        });
    }

    const loginForm = document.querySelector('.login-container');
    if (loginForm && !boundElements.has(loginForm)) {
        boundElements.add(loginForm);
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const email = loginForm.querySelector('#email').value.trim();
            const password = loginForm.querySelector('#password').value;

            try {
                await loginWithEmail(email, password);
                window.location.href = 'dashboard.html';
            } catch (error) {
                showMessage(getFirebaseErrorMessage(error), 'error');
            }
        });
    }

    const forgotPasswordForm = document.querySelector('.forgot-password-form');
    if (forgotPasswordForm && !boundElements.has(forgotPasswordForm)) {
        boundElements.add(forgotPasswordForm);
        forgotPasswordForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const email = forgotPasswordForm.querySelector('#email').value.trim();
            try {
                await sendPasswordReset(email);
                showMessage('Password reset instructions have been sent. Check your inbox and spam folder.');
                forgotPasswordForm.reset();
            } catch (error) {
                showMessage(getFirebaseErrorMessage(error), 'error');
            }
        });
    }

    document.querySelectorAll('.google-btn').forEach((button) => {
        if (boundElements.has(button)) return;
        boundElements.add(button);
        button.type = 'button';
        button.addEventListener('click', async () => {
            try {
                await loginWithGoogle();
                window.location.href = 'dashboard.html';
            } catch (error) {
                showMessage(getFirebaseErrorMessage(error), 'error');
            }
        });
    });
};

const initLogoutButtons = (showMessage) => {
    document.querySelectorAll('#logoutButton, #profileDropdownLogout').forEach((button) => {
        if (boundElements.has(button)) return;
        boundElements.add(button);
        button.addEventListener('click', async () => {
            try {
                await logoutUser();
            } catch (error) {
                if (document.querySelector('.page-shell')) console.error('Failed to sign out', error);
                showMessage('You could not be logged out. Please try again.', 'error');
            }
        });
    });
};

export {
    loginWithEmail,
    registerWithEmail,
    loginWithGoogle,
    logoutUser,
    sendPasswordReset,
    getCurrentUser,
    getUserProfile,
    requireAuthenticatedUser,
    getFirebaseErrorMessage,
    initAuthPages,
    initLogoutButtons
};
