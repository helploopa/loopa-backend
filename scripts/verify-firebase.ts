
import * as admin from 'firebase-admin';
import 'dotenv/config';

console.log('Checking GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS);

try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
        });
    }
    console.log('Firebase Admin initialized successfully!');
    process.exit(0);
} catch (error) {
    console.error('Firebase Admin initialization failed:', error);
    process.exit(1);
}
