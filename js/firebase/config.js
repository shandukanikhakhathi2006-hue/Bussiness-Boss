import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const firebaseConfig = {
	apiKey: 'AIzaSyCCOdG3HgBJ6-BGxS6nA2iaVBwaaok3YSs',
	authDomain: 'business-boss-1b871.firebaseapp.com',
	projectId: 'business-boss-1b871',
	storageBucket: 'business-boss-1b871.firebasestorage.app',
	messagingSenderId: '583044689706',
	appId: '1:583044689706:web:3496dc433aee05c161f853',
	measurementId: 'G-K6T8RSWBLP'
};

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);
export { firebaseApp, auth, firestore };
