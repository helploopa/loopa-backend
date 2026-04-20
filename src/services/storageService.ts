import fs from 'fs';
import path from 'path';

export interface UploadResult {
    storageProvider: string;
    storageKey: string; // local: "sellers/abc/avatar.jpg"  |  s3: "sellers/abc/avatar.jpg"
    publicUrl: string;  // served URL for clients
}

// Root directory where media files are stored on disk.
const MEDIA_ROOT =
    process.env.MEDIA_ROOT ?? '/Users/sarathbabu/Documents/personal/projects/loopa-volume';

// Base URL of this API server — used to build absolute publicUrls.
// Must be set to the address reachable by clients (e.g. http://192.168.1.227:4000).
const API_BASE_URL = (process.env.APP_URL ?? 'http://localhost:4000').replace(/\/$/, '');

// ── Local storage ────────────────────────────────────────────────────────────

function saveToLocal(buffer: Buffer, storageKey: string): string {
    const filePath = path.join(MEDIA_ROOT, storageKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
    // Always return a full absolute URL so clients on any port can resolve it
    return `${API_BASE_URL}/media/${storageKey}`;
}

function deleteFromLocal(storageKey: string): void {
    const filePath = path.join(MEDIA_ROOT, storageKey);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── S3 storage (stub — set STORAGE_PROVIDER=s3 when ready) ──────────────────
// To enable:
//   1. npm install @aws-sdk/client-s3 @aws-sdk/lib-storage
//   2. Set env vars: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET, CDN_BASE_URL
//   3. Replace the stub bodies below with real S3 SDK calls.

async function saveToS3(_buffer: Buffer, _storageKey: string): Promise<string> {
    throw new Error('S3 storage not yet configured. Set STORAGE_PROVIDER=local or implement S3 upload.');
}

async function deleteFromS3(_storageKey: string): Promise<void> {
    throw new Error('S3 storage not yet configured.');
}

// ── Public API ───────────────────────────────────────────────────────────────

const PROVIDER = (process.env.STORAGE_PROVIDER ?? 'local') as 'local' | 's3';

/**
 * Upload a file buffer and return storage metadata.
 * @param buffer    Raw file bytes
 * @param destKey   Relative path/key, e.g. "uploads/sellers/abc/avatar.jpg"
 */
export async function uploadFile(buffer: Buffer, destKey: string): Promise<UploadResult> {
    if (PROVIDER === 's3') {
        const publicUrl = await saveToS3(buffer, destKey);
        return { storageProvider: 's3', storageKey: destKey, publicUrl };
    }

    const publicUrl = saveToLocal(buffer, destKey);
    return { storageProvider: 'local', storageKey: destKey, publicUrl };
}

/**
 * Delete a previously uploaded file.
 */
export async function deleteFile(storageProvider: string, storageKey: string): Promise<void> {
    if (storageProvider === 's3') {
        await deleteFromS3(storageKey);
    } else {
        deleteFromLocal(storageKey);
    }
}

/**
 * Build a deterministic storage key for a given entity image.
 * e.g. "uploads/sellers/abc123/avatar-1713400000000.jpg"
 */
export function buildStorageKey(
    sellerId: string,
    entityType: string,
    filename: string,
    entityId?: string
): string {
    const ext = path.extname(filename) || '.jpg';
    const ts = Date.now();
    return entityId
        ? `sellers/${sellerId}/${entityType}/${entityId}/${ts}${ext}`
        : `sellers/${sellerId}/${entityType}/${ts}${ext}`;
}
