import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js';
import { initializeFirebaseClient, resolveClientEnvironment } from './clientEnvironment.js';

const firebaseConfig = {
	apiKey: 'AIzaSyCCOdG3HgBJ6-BGxS6nA2iaVBwaaok3YSs',
	authDomain: 'business-boss-1b871.firebaseapp.com',
	projectId: 'business-boss-1b871',
	storageBucket: 'business-boss-1b871.firebasestorage.app',
	messagingSenderId: '583044689706',
	appId: '1:583044689706:web:3496dc433aee05c161f853',
	measurementId: 'G-K6T8RSWBLP'
};

const clientEnvironment = resolveClientEnvironment(window.location, {
    getItem: key => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
    removeItem: key => window.sessionStorage.removeItem(key)
});
const { firebaseApp, auth, firestore, functions } = initializeFirebaseClient({
    getApps, initializeApp, getAuth, getFirestore, getFunctions,
    connectAuthEmulator, connectFirestoreEmulator, connectFunctionsEmulator
}, firebaseConfig, clientEnvironment);
export { firebaseApp, auth, firestore, functions, clientEnvironment };
