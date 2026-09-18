// Local routing configuration only. Never a source of business authorization.
export const DEMO_PROJECT_ID = 'demo-businessboss-rules';
export const LOCAL_MODE_KEY = 'businessboss.localEmulators';
export const FUNCTIONS_REGION = 'africa-south1';
const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

// One explicit switch, persisted only within this browser tab so existing Auth
// redirects/navigation remain in the demo project. Remote hosts never use it.
export function resolveClientEnvironment(location, storage) {
    const flags = new URLSearchParams(location.search).getAll('emulator');
    const localHost = loopback(location.hostname) && ['http:', 'https:'].includes(location.protocol);
    if (flags.length > 1 || (flags.length && !['0', '1'].includes(flags[0]))) {
        throw new Error('Invalid local development switch.');
    }
    if (flags[0] === '1' && !localHost) throw new Error('Local development requires a loopback host.');
    let local = false;
    if (localHost) {
        // Storage failure must not silently fall back to the production project.
        if (flags[0] === '1') storage.setItem(LOCAL_MODE_KEY, '1');
        if (flags[0] === '0') storage.removeItem(LOCAL_MODE_KEY);
        local = storage.getItem(LOCAL_MODE_KEY) === '1';
    }
    if (location.pathname.endsWith('/invoices-v2.html') && !local) {
        throw new Error('Invoice v2 requires explicit local emulator mode.');
    }
    return Object.freeze({ local, projectId: local ? DEMO_PROJECT_ID : null });
}

// SDK injection keeps initialization testable without contacting any Firebase
// service. Browser composition passes the real SDK, once, from config.js.
export function initializeFirebaseClient(sdk, productionConfig, environment) {
    const config = environment.local ? {
        apiKey: 'demo-api-key', projectId: DEMO_PROJECT_ID,
        authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`, appId: 'demo-businessboss-web'
    } : productionConfig;
    const apps = sdk.getApps();
    if (apps.length > 1 || (apps.length && apps[0].options.projectId !== config.projectId)) {
        throw new Error('Firebase project mismatch. Reload in the selected environment.');
    }
    const firebaseApp = apps.length ? apps[0] : sdk.initializeApp(config);
    const auth = sdk.getAuth(firebaseApp);
    const firestore = sdk.getFirestore(firebaseApp);
    const functions = sdk.getFunctions(firebaseApp, FUNCTIONS_REGION);
    if (environment.local) {
        sdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099');
        sdk.connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
        sdk.connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    }
    return { firebaseApp, auth, firestore, functions };
}
