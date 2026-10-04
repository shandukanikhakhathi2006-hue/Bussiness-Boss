import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app-check.js';
import { productionAppCheckSiteKey } from './appCheckConfig.js';

// Local emulator sessions intentionally do not use App Check. Production
// initialization is conditional only because the Console-issued public site key
// has not been configured in source control yet; callable enforcement remains on.
export function initializeProductionAppCheck(firebaseApp, environment) {
    if (environment.local) return null;
    if (!productionAppCheckSiteKey) {
        console.warn('Firebase App Check is not configured for this production build. Invoice v2 callables will reject requests until the production provider site key is configured.');
        return null;
    }
    return initializeAppCheck(firebaseApp, {
        provider: new ReCaptchaEnterpriseProvider(productionAppCheckSiteKey),
        isTokenAutoRefreshEnabled: true
    });
}