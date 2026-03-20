
import * as admin from 'firebase-admin';
import 'dotenv/config';

// Initialize Firebase Admin
if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
        });
    } catch (error) {
        console.error('Firebase Admin initialization failed:', error);
        process.exit(1);
    }
}

const uid = process.argv[2] || 'test-user-123';

admin.auth().createCustomToken(uid)
    .then((customToken) => {
        console.log(customToken);
        process.exit(0);
    })
    .catch((error) => {
        console.error('Error creating custom token:', error);
        process.exit(1);
    });
