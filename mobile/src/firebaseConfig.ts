import { initializeApp } from 'firebase/app';
import { getMessaging, getToken } from 'firebase/messaging';

// Firebase web config — values injected from EXPO_PUBLIC_* env vars (see .env.example).
// A Firebase Web API key is a project *identifier*, not a secret: access is gated by
// Firebase Security Rules + API key restrictions in Google Cloud Console, not by the key
// staying private. We still keep it out of source so secret scanners don't flag it and so
// the project can be reconfigured without a code change.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

export async function getFirebasePushToken(): Promise<string> {
  try {
    const token = await getToken(messaging, {
      vapidKey: process.env.EXPO_PUBLIC_FIREBASE_VAPID_KEY
    });
    console.log('Firebase token:', token);
    return token;
  } catch (error) {
    console.error('Error getting Firebase token:', error);
    throw error;
  }
}

export { messaging, app };
