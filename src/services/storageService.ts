import fs from 'fs';
import path from 'path';
import * as admin from 'firebase-admin';
import '../firebase'; // ensure Firebase Admin is initialized

export interface UploadResult {
  storageProvider: string;
  storageKey: string;
  publicUrl: string;
}

const PROVIDER = (process.env.STORAGE_PROVIDER ?? 'local') as 'local' | 'firebase';

// ── Firebase Cloud Storage ───────────────────────────────────────────────────

function getBucket() {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  if (!bucketName) throw new Error('FIREBASE_STORAGE_BUCKET env var is not set');
  return admin.storage().bucket(bucketName);
}

async function saveToFirebase(buffer: Buffer, storageKey: string, mimeType: string): Promise<string> {
  const bucket = getBucket();
  const file = bucket.file(storageKey);
  await file.save(buffer, { metadata: { contentType: mimeType }, public: true });
  // Firebase Storage public CDN URL
  const encoded = storageKey.split('/').map(encodeURIComponent).join('/');
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media`;
}

async function deleteFromFirebase(storageKey: string): Promise<void> {
  const bucket = getBucket();
  await bucket.file(storageKey).delete({ ignoreNotFound: true } as any);
}

// ── Local storage (development only) ────────────────────────────────────────

const MEDIA_ROOT = process.env.MEDIA_ROOT ?? '/uploads';
const API_BASE_URL = (process.env.APP_URL ?? 'http://localhost:4000').replace(/\/$/, '');

function saveToLocal(buffer: Buffer, storageKey: string): string {
  const filePath = path.join(MEDIA_ROOT, storageKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return `${API_BASE_URL}/media/${storageKey}`;
}

function deleteFromLocal(storageKey: string): void {
  const filePath = path.join(MEDIA_ROOT, storageKey);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function uploadFile(buffer: Buffer, destKey: string, mimeType = 'image/jpeg'): Promise<UploadResult> {
  if (PROVIDER === 'firebase') {
    const publicUrl = await saveToFirebase(buffer, destKey, mimeType);
    return { storageProvider: 'firebase', storageKey: destKey, publicUrl };
  }
  const publicUrl = saveToLocal(buffer, destKey);
  return { storageProvider: 'local', storageKey: destKey, publicUrl };
}

export async function deleteFile(storageProvider: string, storageKey: string): Promise<void> {
  if (storageProvider === 'firebase') {
    await deleteFromFirebase(storageKey);
  } else {
    deleteFromLocal(storageKey);
  }
}

export function buildStorageKey(sellerId: string, entityType: string, filename: string, entityId?: string): string {
  const ext = path.extname(filename) || '.jpg';
  const ts = Date.now();
  return entityId
    ? `sellers/${sellerId}/${entityType}/${entityId}/${ts}${ext}`
    : `sellers/${sellerId}/${entityType}/${ts}${ext}`;
}
