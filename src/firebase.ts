import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    let credential: admin.credential.Credential;
    if (serviceAccountJson) {
      const parsed = JSON.parse(serviceAccountJson) as admin.ServiceAccount;
      // Vercel stores env vars as strings — \n in the private key becomes a literal
      // backslash-n, breaking JWT signing. Replace them with real newlines.
      if (parsed.privateKey) {
        (parsed as any).privateKey = parsed.privateKey.replace(/\\n/g, '\n');
      }
      credential = admin.credential.cert(parsed);
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
