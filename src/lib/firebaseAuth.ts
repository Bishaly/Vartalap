import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify'
] as const;

export const OPTIONAL_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly'
] as const;

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

function createGoogleProvider(includeDrive: boolean): GoogleAuthProvider {
  const p = new GoogleAuthProvider();
  GMAIL_SCOPES.forEach((scope) => p.addScope(scope));
  if (includeDrive) {
    OPTIONAL_DRIVE_SCOPES.forEach((scope) => p.addScope(scope));
  }
  p.setCustomParameters({
    prompt: includeDrive ? 'consent' : 'select_account'
  });
  return p;
}

let isSigningIn = false;
// Access token is strictly kept in memory only (never localStorage or sessionStorage).
let cachedAccessToken: string | null = null;
let hasDriveConsent = false;

export const initAuth = (
  onAuthenticated: (user: User, accessToken: string) => void,
  onUnauthenticated: () => void
) => {
  return onAuthStateChanged(auth, (user) => {
    if (user && cachedAccessToken) {
      onAuthenticated(user, cachedAccessToken);
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      hasDriveConsent = false;
      onUnauthenticated();
    }
  });
};

export const signInWithGoogleGmail = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, createGoogleProvider(false));
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google sign-in did not return a Gmail access token.');
    }
    cachedAccessToken = credential.accessToken;
    hasDriveConsent = false;
    return {
      user: result.user,
      accessToken: cachedAccessToken
    };
  } finally {
    isSigningIn = false;
  }
};

// Incremental OAuth consent: requested ONLY when user enables Google Drive features.
export const requestOptionalDriveAccess = async (): Promise<string> => {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, createGoogleProvider(true));
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google Drive permission was not granted.');
    }
    cachedAccessToken = credential.accessToken;
    hasDriveConsent = true;
    return cachedAccessToken;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = (): string | null => cachedAccessToken;

export const isDriveConsentGranted = (): boolean => hasDriveConsent;

export const disconnectGoogleAccount = async (): Promise<void> => {
  const token = cachedAccessToken;
  cachedAccessToken = null;
  hasDriveConsent = false;
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
    } catch {
      // Ignore network errors during best-effort revocation
    }
  }
  await signOut(auth);
};
