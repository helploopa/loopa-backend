import * as admin from 'firebase-admin';

// Initialize Firebase Admin
// Expects FIREBASE_SERVICE_ACCOUNT to be a path to the service account JSON file
// or GOOGLE_APPLICATION_CREDENTIALS environment variable.

if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
        });
        console.log('Firebase Admin initialized successfully');
    } catch (error) {
        console.error('Firebase Admin initialization failed:', error);
    }
}

export const verifyToken = async (token: string) => {
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        return decodedToken;
    } catch (error) {
        console.error('Error verifying Firebase token:', error);
        return null;
    }
};
