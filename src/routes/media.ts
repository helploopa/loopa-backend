import { Router, Request, Response } from 'express';
import multer from 'multer';
import { prisma } from '../context';
import { authenticateToken } from '../middleware/auth';
import { uploadFile, deleteFile, buildStorageKey } from '../services/storageService';

const router = Router();

// ── Multer: memory storage, up to 10 files × 10 MB each ─────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed'));
        }
        cb(null, true);
    },
}).array('files', 10);

// ── Helpers ──────────────────────────────────────────────────────────────────

function requireFiles(req: Request): Express.Multer.File[] | null {
    const files = req.files as Express.Multer.File[] | undefined;
    return files && files.length > 0 ? files : null;
}

async function assertSellerOwner(
    sellerId: string,
    userId: string
): Promise<{ ok: true; sellerId: string } | { ok: false; status: number; error: string; message: string }> {
    const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
    if (!seller) return { ok: false, status: 404, error: 'NOT_FOUND', message: `Seller ${sellerId} not found` };
    if (seller.userId !== userId) return { ok: false, status: 403, error: 'FORBIDDEN', message: 'Access denied' };
    return { ok: true, sellerId: seller.id };
}

async function syncPrimaryUrl(
    entityType: string,
    entityId: string | undefined,
    sellerId: string,
    publicUrl: string
) {
    if (entityType === 'seller_avatar') {
        await prisma.seller.update({ where: { id: sellerId }, data: { avatarUrl: publicUrl } });
    } else if (entityType === 'seller_cover') {
        await prisma.seller.update({ where: { id: sellerId }, data: { coverPhoto: publicUrl } });
    } else if (entityType === 'product' && entityId) {
        await prisma.product.update({ where: { id: entityId }, data: { primaryImage: publicUrl } });
    }
}

/**
 * Save all files for an entity group, marking the first as primary.
 * Deletes existing records first when `replaceExisting` is true.
 */
async function saveMediaFiles(
    files: Express.Multer.File[],
    sellerId: string,
    entityType: string,
    entityId: string | undefined,
    replaceExisting: boolean
): Promise<typeof import('@prisma/client').Prisma extends never ? never : Awaited<ReturnType<typeof prisma.sellerMedia.create>>[]> {
    if (replaceExisting) {
        const existing = await prisma.sellerMedia.findMany({
            where: { sellerId, entityType, ...(entityId ? { entityId } : {}) },
        });
        await Promise.all(existing.map((m) => deleteFile(m.storageProvider, m.storageKey)));
        await prisma.sellerMedia.deleteMany({
            where: { sellerId, entityType, ...(entityId ? { entityId } : {}) },
        });
    }

    const startOrder = replaceExisting
        ? 0
        : await prisma.sellerMedia.count({
              where: { sellerId, entityType, ...(entityId ? { entityId } : {}) },
          });

    const created = await Promise.all(
        files.map(async (file, idx) => {
            const storageKey = buildStorageKey(sellerId, entityType, file.originalname, entityId);
            const { storageProvider, publicUrl } = await uploadFile(file.buffer, storageKey);
            return prisma.sellerMedia.create({
                data: {
                    sellerId,
                    entityType,
                    entityId: entityId ?? null,
                    filename: file.originalname,
                    mimeType: file.mimetype,
                    sizeBytes: file.size,
                    storageProvider,
                    storageKey,
                    publicUrl,
                    isPrimary: replaceExisting ? idx === 0 : false,
                    sortOrder: startOrder + idx,
                },
            });
        })
    );

    return created;
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/media/sellers/:sellerId/avatar
// Accepts multiple files; first becomes primary, rest are stored as alternates.
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/media/sellers/{sellerId}/avatar:
 *   post:
 *     summary: Upload seller avatar(s) — replaces existing. First file becomes primary.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: Media records created
 */
router.post('/sellers/:sellerId/avatar', authenticateToken, upload, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const files = requireFiles(req);
    if (!files) { res.status(400).json({ error: 'VALIDATION_ERROR', message: 'At least one file is required' }); return; }

    const check = await assertSellerOwner(req.params.sellerId as string, userId);
    if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

    try {
        const created = await saveMediaFiles(files, check.sellerId, 'seller_avatar', undefined, true);
        await syncPrimaryUrl('seller_avatar', undefined, check.sellerId, created[0].publicUrl);
        res.status(201).json(created);
    } catch (err) {
        console.error('Avatar upload error:', err);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Upload failed' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/media/sellers/:sellerId/cover
// Accepts multiple files; replaces all existing cover photos.
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/media/sellers/{sellerId}/cover:
 *   post:
 *     summary: Upload seller cover photo(s) — replaces existing. First file becomes primary.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: Media records created
 */
router.post('/sellers/:sellerId/cover', authenticateToken, upload, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const files = requireFiles(req);
    if (!files) { res.status(400).json({ error: 'VALIDATION_ERROR', message: 'At least one file is required' }); return; }

    const check = await assertSellerOwner(req.params.sellerId as string, userId);
    if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

    try {
        const created = await saveMediaFiles(files, check.sellerId, 'seller_cover', undefined, true);
        await syncPrimaryUrl('seller_cover', undefined, check.sellerId, created[0].publicUrl);
        res.status(201).json(created);
    } catch (err) {
        console.error('Cover upload error:', err);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Upload failed' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/media/sellers/:sellerId/work-photos
// Appends to existing work photos. Does NOT replace.
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/media/sellers/{sellerId}/work-photos:
 *   post:
 *     summary: Upload work photos (appended, not replaced). Max 10 files per request.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: Media records created
 */
router.post('/sellers/:sellerId/work-photos', authenticateToken, upload, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const files = requireFiles(req);
    if (!files) { res.status(400).json({ error: 'VALIDATION_ERROR', message: 'At least one file is required' }); return; }

    const check = await assertSellerOwner(req.params.sellerId as string, userId);
    if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

    try {
        const created = await saveMediaFiles(files, check.sellerId, 'seller_work_photo', undefined, false);

        const allWorkPhotos = await prisma.sellerMedia.findMany({
            where: { sellerId: check.sellerId, entityType: 'seller_work_photo' },
            orderBy: { sortOrder: 'asc' },
            select: { publicUrl: true },
        });
        await prisma.seller.update({
            where: { id: check.sellerId },
            data: { workPhotos: allWorkPhotos.map((m) => m.publicUrl) },
        });

        res.status(201).json(created);
    } catch (err) {
        console.error('Work photo upload error:', err);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Upload failed' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/media/sellers/:sellerId/products/:productId
// Appends product images. First ever upload auto-sets isPrimary on idx 0.
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/media/sellers/{sellerId}/products/{productId}:
 *   post:
 *     summary: Upload product images (appended). Max 10 files per request.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: Media records created
 */
router.post('/sellers/:sellerId/products/:productId', authenticateToken, upload, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const files = requireFiles(req);
    if (!files) { res.status(400).json({ error: 'VALIDATION_ERROR', message: 'At least one file is required' }); return; }

    const { sellerId, productId } = req.params as { sellerId: string; productId: string };

    const check = await assertSellerOwner(sellerId, userId);
    if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.sellerId !== check.sellerId) {
        res.status(404).json({ error: 'NOT_FOUND', message: `Product ${productId} not found` });
        return;
    }

    try {
        const existingCount = await prisma.sellerMedia.count({
            where: { sellerId: check.sellerId, entityType: 'product', entityId: productId },
        });
        const isFirstBatch = existingCount === 0;

        // saveMediaFiles appends and does not set isPrimary — handle first batch manually
        const created = await saveMediaFiles(files, check.sellerId, 'product', productId, false);

        if (isFirstBatch && created.length > 0) {
            await prisma.sellerMedia.update({ where: { id: created[0].id }, data: { isPrimary: true } });
            created[0].isPrimary = true;
        }

        const allProductMedia = await prisma.sellerMedia.findMany({
            where: { sellerId: check.sellerId, entityType: 'product', entityId: productId },
            orderBy: { sortOrder: 'asc' },
        });
        const primary = allProductMedia.find((m) => m.isPrimary) ?? allProductMedia[0];
        await prisma.product.update({
            where: { id: productId },
            data: {
                images: allProductMedia.map((m) => m.publicUrl),
                primaryImage: primary?.publicUrl ?? null,
            },
        });

        res.status(201).json(created);
    } catch (err) {
        console.error('Product image upload error:', err);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Upload failed' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/media/sellers/:sellerId
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/media/sellers/{sellerId}:
 *   get:
 *     summary: List all media for a seller
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [seller_avatar, seller_cover, seller_work_photo, product]
 *       - in: query
 *         name: entityId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Array of media records
 */
router.get('/sellers/:sellerId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const check = await assertSellerOwner(req.params.sellerId as string, userId);
    if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

    const { type, entityId } = req.query as { type?: string; entityId?: string };

    const media = await prisma.sellerMedia.findMany({
        where: {
            sellerId: check.sellerId,
            ...(type && { entityType: type }),
            ...(entityId && { entityId }),
        },
        orderBy: [{ entityType: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    res.status(200).json(media);
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/media/:mediaId/set-primary
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/media/{mediaId}/set-primary:
 *   patch:
 *     summary: Set a media record as the primary image in its group
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mediaId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Updated media record
 */
router.patch('/:mediaId/set-primary', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const media = await prisma.sellerMedia.findUnique({ where: { id: req.params.mediaId as string } });
    if (!media) { res.status(404).json({ error: 'NOT_FOUND', message: 'Media not found' }); return; }

    const check = await assertSellerOwner(media.sellerId, userId);
    if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

    await prisma.$transaction([
        prisma.sellerMedia.updateMany({
            where: { sellerId: media.sellerId, entityType: media.entityType, entityId: media.entityId ?? undefined },
            data: { isPrimary: false },
        }),
        prisma.sellerMedia.update({ where: { id: media.id }, data: { isPrimary: true } }),
    ]);

    await syncPrimaryUrl(media.entityType, media.entityId ?? undefined, media.sellerId, media.publicUrl);

    const updated = await prisma.sellerMedia.findUnique({ where: { id: media.id } });
    res.status(200).json(updated);
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/media/:mediaId/sort
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/media/{mediaId}/sort:
 *   patch:
 *     summary: Update sort order of a media record
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mediaId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sortOrder]
 *             properties:
 *               sortOrder:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Updated media record
 */
router.patch('/:mediaId/sort', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const sortOrder = Number(req.body.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'sortOrder must be a non-negative integer' });
        return;
    }

    const media = await prisma.sellerMedia.findUnique({ where: { id: req.params.mediaId as string } });
    if (!media) { res.status(404).json({ error: 'NOT_FOUND', message: 'Media not found' }); return; }

    const check = await assertSellerOwner(media.sellerId, userId);
    if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

    const updated = await prisma.sellerMedia.update({ where: { id: media.id }, data: { sortOrder } });
    res.status(200).json(updated);
});

// ════════════════════════════════════════════════════════════════════════════
// DELETE /api/media/:mediaId
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/media/{mediaId}:
 *   delete:
 *     summary: Delete a media record and its stored file
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: mediaId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted successfully
 */
router.delete('/:mediaId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const media = await prisma.sellerMedia.findUnique({ where: { id: req.params.mediaId as string } });
    if (!media) { res.status(404).json({ error: 'NOT_FOUND', message: 'Media not found' }); return; }

    const check = await assertSellerOwner(media.sellerId, userId);
    if (!check.ok) { res.status(check.status).json({ error: check.error, message: check.message }); return; }

    await deleteFile(media.storageProvider, media.storageKey);
    await prisma.sellerMedia.delete({ where: { id: media.id } });

    // Auto-promote next image if the deleted one was primary
    if (media.isPrimary) {
        const next = await prisma.sellerMedia.findFirst({
            where: { sellerId: media.sellerId, entityType: media.entityType, entityId: media.entityId ?? undefined },
            orderBy: { sortOrder: 'asc' },
        });
        if (next) {
            await prisma.sellerMedia.update({ where: { id: next.id }, data: { isPrimary: true } });
            await syncPrimaryUrl(next.entityType, next.entityId ?? undefined, next.sellerId, next.publicUrl);
        } else {
            await syncPrimaryUrl(media.entityType, media.entityId ?? undefined, media.sellerId, '');
        }
    }

    // Re-sync array fields for work photos and product images
    if (media.entityType === 'seller_work_photo') {
        const remaining = await prisma.sellerMedia.findMany({
            where: { sellerId: media.sellerId, entityType: 'seller_work_photo' },
            orderBy: { sortOrder: 'asc' },
        });
        await prisma.seller.update({
            where: { id: media.sellerId },
            data: { workPhotos: remaining.map((m) => m.publicUrl) },
        });
    } else if (media.entityType === 'product' && media.entityId) {
        const remaining = await prisma.sellerMedia.findMany({
            where: { sellerId: media.sellerId, entityType: 'product', entityId: media.entityId },
            orderBy: { sortOrder: 'asc' },
        });
        const primary = remaining.find((m) => m.isPrimary) ?? remaining[0];
        await prisma.product.update({
            where: { id: media.entityId },
            data: {
                images: remaining.map((m) => m.publicUrl),
                primaryImage: primary?.publicUrl ?? null,
            },
        });
    }

    res.status(200).json({ message: 'Deleted successfully' });
});

export default router;
