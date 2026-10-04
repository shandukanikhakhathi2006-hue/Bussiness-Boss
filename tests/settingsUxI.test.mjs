import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    isPasswordAccount,
    normalizeSettingsProfile,
    profileInitials,
    settingsErrorMessage
} from '../js/features/settingsWorkspaceState.js';

const page = fs.readFileSync(new URL('../settings.html', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../js/features/settingsWorkspace.js', import.meta.url), 'utf8');
const appScript = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../dashboard.css', import.meta.url), 'utf8');

test('Settings has an account-first hierarchy with one page heading and truthful information sections', () => {
    assert.equal((page.match(/<h1\b/g) || []).length, 1);
    assert.match(page, /<h1 class="page-title" id="settingsTitle">Settings<\/h1>/);
    assert.match(page, /id="profile" aria-labelledby="profileSettingsTitle"/);
    assert.match(page, /id="security" aria-labelledby="securitySettingsTitle"/);
    assert.match(page, /id="product-information" aria-labelledby="productInformationTitle"/);
    assert.match(page, /id="support-information" aria-labelledby="supportInformationTitle"/);
    assert.match(page, /Subscription and payment management are not available in the workspace yet\./);
    assert.match(page, /Support contact availability is being verified\./);
    assert.doesNotMatch(page, /Plans &amp; billing/);
});

test('Settings uses labelled semantic forms and accessible feedback', () => {
    assert.match(page, /<nav class="settings-navigation" aria-label="Settings sections">/);
    assert.match(page, /<form data-settings-profile-form novalidate>/);
    assert.match(page, /<label for="fullName">Full name<\/label>/);
    assert.match(page, /<label for="email">Email address<\/label>/);
    assert.match(page, /<label for="phone">Phone number/);
    assert.match(page, /data-settings-profile-feedback aria-live="polite" hidden/);
    assert.match(page, /<form data-settings-security-form novalidate>/);
    assert.match(page, /autocomplete="current-password"/);
    assert.match(page, /autocomplete="new-password"/);
    assert.match(page, /data-settings-security-feedback aria-live="polite" hidden/);
    assert.match(page, /<button class="secondary-button" type="button" id="changePictureButton">Change photo<\/button>/);
});

test('Settings keeps real account persistence while isolating its controller from the general page script', () => {
    assert.match(workspace, /getDoc\(doc\(firestore, 'users', uid\)\)/);
    assert.match(workspace, /setDoc\(doc\(firestore, 'users', uid\), data, \{ merge: true \}\)/);
    assert.match(workspace, /await updateProfile\(currentUser, \{ displayName: name \}\)/);
    assert.match(workspace, /await updateEmail\(currentUser, requestedEmail\)/);
    assert.match(workspace, /await reauthenticateWithCredential\(currentUser, credential\)/);
    assert.match(workspace, /await updatePassword\(currentUser, next\)/);
    assert.match(workspace, /fullName: name,[\s\S]*phone: phone\.value\.trim\(\),[\s\S]*updatedAt: serverTimestamp\(\)/);
    assert.doesNotMatch(workspace, /localStorage/);
    assert.doesNotMatch(appScript, /const loadSettings/);
    assert.doesNotMatch(appScript, /profileSaveButton/);
    assert.match(page, /js\/features\/settingsWorkspace\.js/);
});

test('Settings profiles normalise real values and distinguish password and federated sign-ins', () => {
    assert.deepEqual(
        normalizeSettingsProfile(
            { fullName: '  Record name  ', email: 'record@example.test', phone: ' 071 000 0000 ', photoURL: 'photo' },
            { displayName: 'Auth name', email: 'auth@example.test', photoURL: 'auth-photo' }
        ),
        { fullName: 'Record name', email: 'auth@example.test', phone: '071 000 0000', photoURL: 'photo' }
    );
    assert.equal(isPasswordAccount({ providerData: [{ providerId: 'password' }] }), true);
    assert.equal(isPasswordAccount({ providerData: [{ providerId: 'google.com' }] }), false);
    assert.equal(profileInitials('Tom & Sons'), 'T&');
    assert.match(settingsErrorMessage({ code: 'auth/requires-recent-login' }), /sign in again/i);
    assert.match(settingsErrorMessage({ code: 'auth/invalid-credential' }), /current password/i);
    assert.match(settingsErrorMessage({ code: 'auth/network-request-failed' }), /connection/i);
});

test('Settings has focused loading, retry, failure, and duplicate-submit protections', () => {
    assert.match(workspace, /Loading profile…/);
    assert.match(workspace, /Your saved profile details could not be loaded\. You can retry or save updated details\./);
    assert.match(workspace, /retry\.addEventListener\('click', load\)/);
    assert.match(workspace, /profileSaving \|\| !profileForm\.reportValidity\(\)/);
    assert.match(workspace, /profileSubmit\.disabled = true/);
    assert.match(workspace, /profileSaving = false;[\s\S]*profileSubmit\.disabled = false/);
    assert.match(workspace, /passwordSaving \|\| !isPasswordAccount\(currentUser\)/);
    assert.match(workspace, /passwordSubmit\.disabled = true/);
    assert.match(workspace, /passwordSaving = false;[\s\S]*passwordSubmit\.disabled = false/);
    assert.match(workspace, /target\.hidden = !message/);
});

test('Settings layout stays readable at tablet and narrow mobile widths', () => {
    assert.match(styles, /\.settings-workspace\s*\{[\s\S]*?grid-template-columns: minmax\(190px, 0\.28fr\) minmax\(0, 1fr\);/);
    assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.settings-workspace/);
    assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.settings-workspace\s*\{\s*display: block;/);
    assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.settings-navigation\s*\{[\s\S]*?overflow-x: auto;/);
    assert.match(styles, /@media \(max-width: 480px\)[\s\S]*?\.settings-actions\s*\{[\s\S]*?flex-direction: column-reverse;/);
    assert.match(styles, /\.settings-field input\s*\{[\s\S]*?min-width: 0;[\s\S]*?width: 100%;/);
    assert.match(styles, /\.settings-nav-link:focus-visible/);
});
