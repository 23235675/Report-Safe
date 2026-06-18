import { initializeApp } from 'firebase/app';
import { getMessaging, getToken } from 'firebase/messaging';

// This config comes from google-services.json
const firebaseConfig = {
  apiKey: "AIzaSyBRDuBQD1m-z0hOZkBnIVYb6a25DKqL0C8",
  authDomain: "report-safe-ba385.firebaseapp.com",
  projectId: "report-safe-ba385",
  storageBucket: "report-safe-ba385.firebasestorage.app",
  messagingSenderId: "835049764481",
  appId: "1:835049764481:android:190a26d2fe51a205db3f80"
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
