import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    let credential: admin.credential.Credential;
    if (serviceAccountJson) {
      // JSON.parse gives snake_case keys as-is from the Google service account file.
      // Vercel stores env vars as plain strings, so the \n in private_key becomes
      // a literal backslash-n. Replace them with real newlines before signing.
      const parsed = JSON.parse(serviceAccountJson);
      if (parsed.private_key) {
        parsed.private_key = (parsed.private_key as string).replace(/\\n/g, '\n');
      }
      credential = admin.credential.cert(parsed as admin.ServiceAccount);
    } else {
      credential = admin.credential.applicationDefault();
    }

    admin.initializeApp({ credential });
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
