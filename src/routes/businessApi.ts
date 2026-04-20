import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../context';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// ── Image upload (local disk, 5 MB cap) ─────────────────────────────────────
const storage = multer.diskStorage({
    destination: path.join(process.cwd(), 'uploads'),
    filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}${path.extname(file.originalname)}`);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
        cb(null, true);
    },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const LICENSE_VALUES = ['yes', 'no', 'not_required'] as const;

/**
 * If value looks like a base64 data-URL, save to disk and return a server URL.
 * Otherwise return the value as-is (already a URL).
 */
function resolveImageField(value: string | undefined, prefix: string): string | undefined {
    if (!value) return undefined;
    if (!value.startsWith('data:image/')) return value;

    const matches = value.match(/^data:image\/(\w+);base64,(.+)$/s);
    if (!matches) return undefined;

    const ext = matches[1];
    const data = matches[2];
    const filename = `${prefix}-${Date.now()}.${ext}`;
    const filePath = path.join(process.cwd(), 'uploads', filename);
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    return `/uploads/${filename}`;
}

function resolveImageArray(values: string[] | undefined, prefix: string): string[] {
    if (!values || !Array.isArray(values)) return [];
    return values
        .map((v, i) => resolveImageField(v, `${prefix}-${i}`))
        .filter((v): v is string => !!v);
}

/** Shape returned by all /api/businesses endpoints */
function formatBusiness(seller: any) {
    return {
        id: seller.id,
        status: seller.status,
        name: seller.name,
        tagline: seller.tagline ?? null,
        location: seller.location ?? null,
        latitude: seller.latitude ?? 0,
        longitude: seller.longitude ?? 0,
        city: seller.city ?? null,
        state: seller.state ?? null,
        serviceType: seller.serviceType ?? null,
        categories: seller.categories ?? [],
        avatarUrl: seller.avatarUrl ?? null,
        coverPhoto: seller.coverPhoto ?? null,
        bio: seller.bio ?? null,
        workPhotos: seller.workPhotos ?? [],
        businessLicense: seller.businessLicense ?? null,
        delivery: {
            available: seller.delivery ?? false,
            radiusMiles: seller.deliveryRadiusMiles ?? null,
        },
        sampling: {
            available: (seller.samplesPerMonth ?? 0) > 0,
            samplesPerMonth: seller.samplesPerMonth ?? null,
        },
        orderCapDollars: seller.orderCapDollars ?? null,
        publishedAt: seller.publishedAt ?? null,
        createdAt: seller.createdAt,
        updatedAt: seller.updatedAt,
    };
}

// ── Zod schemas ──────────────────────────────────────────────────────────────

const step1Schema = z.object({
    name: z.string().min(1, 'name is required').max(100),
    tagline: z.string().max(200).optional(),
    location: z.string().max(200).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    serviceType: z.enum(['product', 'service']).optional(),
    categories: z.array(z.string()).optional(),
    avatar: z.string().optional(), // base64 or URL
});

const step2Schema = z.object({
    bio: z.string().max(2000).optional(),
    workPhotos: z.array(z.string()).optional(),
    businessLicense: z.enum(LICENSE_VALUES).optional(),
    delivery: z
        .object({
            available: z.boolean(),
            radiusMiles: z.number().nonnegative().optional(),
        })
        .optional(),
    sampling: z
        .object({
            available: z.boolean(),
            samplesPerMonth: z.number().int().nonnegative().optional(),
        })
        .optional(),
    orderCapDollars: z.number().nonnegative().optional(),
});

// step1Schema fields are also valid for PATCH /:id
const patchSchema = z.object({
    ...step1Schema.shape,
    ...step2Schema.shape,
}).partial();

// ── Auth helper ──────────────────────────────────────────────────────────────
function getUserId(req: Request): string | null {
    return (req.user?.userId as string) ?? null;
}

async function findSellerForUser(id: string, userId: string) {
    const seller = await prisma.seller.findUnique({ where: { id } });
    if (!seller) return { seller: null, error: 'NOT_FOUND' };
    if (seller.userId !== userId) return { seller: null, error: 'FORBIDDEN' };
    return { seller, error: null };
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/businesses/mine  — return the authenticated user's own business
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/businesses/mine:
 *   get:
 *     summary: Get the authenticated user's own business
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Business profile
 *       404:
 *         description: No business found for this user
 */
router.get('/mine', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    try {
        const seller = await prisma.seller.findUnique({ where: { userId } });
        if (!seller) { res.status(404).json({ error: 'NOT_FOUND', message: 'No business found for this user' }); return; }
        res.json(formatBusiness(seller));
    } catch (err) {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/businesses  — Step 1: create draft
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/businesses:
 *   post:
 *     summary: Step 1 — Create business draft
 *     description: Creates a new seller/business in draft status for the authenticated user.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               tagline:
 *                 type: string
 *               location:
 *                 type: string
 *               serviceType:
 *                 type: string
 *                 enum: [product, service]
 *               categories:
 *                 type: array
 *                 items:
 *                   type: string
 *               avatar:
 *                 type: string
 *                 description: base64 data-URL or CDN URL
 *     responses:
 *       201:
 *         description: Draft business created
 *       400:
 *         description: Validation error
 *       409:
 *         description: Seller profile already exists for this user
 */
router.post('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const parsed = step1Schema.safeParse(req.body);
    if (!parsed.success) {
        const first = parsed.error.issues[0];
        res.status(400).json({ error: 'VALIDATION_ERROR', message: first.message });
        return;
    }

    const { name, tagline, location, latitude, longitude, city, state, serviceType, categories, avatar } = parsed.data;

    const existing = await prisma.seller.findUnique({ where: { userId } });
    if (existing) {
        res.status(409).json({
            error: 'ALREADY_EXISTS',
            message: 'A business already exists for this account',
            id: existing.id,
        });
        return;
    }

    const avatarUrl = resolveImageField(avatar, `avatar-${userId}`);

    try {
        const seller = await prisma.seller.create({
            data: {
                userId,
                name,
                description: tagline ?? '',
                tagline: tagline ?? null,
                location: location ?? null,
                latitude: latitude ?? 0,
                longitude: longitude ?? 0,
                city: city ?? null,
                state: state ?? null,
                serviceType: serviceType ?? null,
                categories: categories ?? [],
                avatarUrl: avatarUrl ?? null,
                status: 'draft',
            },
        });

        res.status(201).json(formatBusiness(seller));
    } catch (err) {
        console.error('Error creating business:', err);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/businesses/:id  — fetch full profile
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/businesses/{id}:
 *   get:
 *     summary: Get full business profile
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Business profile
 *       404:
 *         description: Not found
 */
router.get('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { seller, error } = await findSellerForUser(req.params.id as string, userId);
    if (error === 'NOT_FOUND') {
        res.status(404).json({ error: 'NOT_FOUND', message: `Business ${req.params.id} not found` });
        return;
    }
    if (error === 'FORBIDDEN') {
        res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied' });
        return;
    }

    res.status(200).json(formatBusiness(seller));
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/businesses/:id/details  — Step 2: trust & details
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/businesses/{id}/details:
 *   patch:
 *     summary: Step 2 — Update trust & details
 *     description: Adds bio, work photos, delivery/sampling settings, and license info. Status stays "draft".
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               bio:
 *                 type: string
 *               workPhotos:
 *                 type: array
 *                 items:
 *                   type: string
 *               businessLicense:
 *                 type: string
 *                 enum: [yes, no, not_required]
 *               delivery:
 *                 type: object
 *                 properties:
 *                   available:
 *                     type: boolean
 *                   radiusMiles:
 *                     type: number
 *               sampling:
 *                 type: object
 *                 properties:
 *                   available:
 *                     type: boolean
 *                   samplesPerMonth:
 *                     type: integer
 *               orderCapDollars:
 *                 type: number
 *     responses:
 *       200:
 *         description: Details updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: Not found
 */
router.patch('/:id/details', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { seller, error } = await findSellerForUser(req.params.id as string, userId);
    if (error === 'NOT_FOUND') {
        res.status(404).json({ error: 'NOT_FOUND', message: `Business ${req.params.id} not found` });
        return;
    }
    if (error === 'FORBIDDEN') {
        res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied' });
        return;
    }

    const parsed = step2Schema.safeParse(req.body);
    if (!parsed.success) {
        const first = parsed.error.issues[0];
        res.status(400).json({ error: 'VALIDATION_ERROR', message: first.message });
        return;
    }

    const { bio, workPhotos, businessLicense, delivery, sampling, orderCapDollars } = parsed.data;
    const resolvedPhotos = resolveImageArray(workPhotos, `work-${seller!.id}`);

    try {
        const updated = await prisma.seller.update({
            where: { id: seller!.id },
            data: {
                ...(bio !== undefined && { bio }),
                ...(workPhotos !== undefined && { workPhotos: resolvedPhotos }),
                ...(businessLicense !== undefined && { businessLicense }),
                ...(delivery !== undefined && {
                    delivery: delivery.available,
                    deliveryRadiusMiles: delivery.radiusMiles ?? null,
                }),
                ...(sampling !== undefined && {
                    samplesPerMonth: sampling.available ? (sampling.samplesPerMonth ?? 1) : 0,
                }),
                ...(orderCapDollars !== undefined && { orderCapDollars }),
            },
        });

        res.status(200).json(formatBusiness(updated));
    } catch (err) {
        console.error('Error updating business details:', err);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/businesses/:id/publish  — Step 3: go live
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/businesses/{id}/publish:
 *   post:
 *     summary: Step 3 — Publish business
 *     description: Transitions the business from "draft" to "active". Validates required fields are present.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Business is now active
 *       400:
 *         description: Missing required fields
 *       404:
 *         description: Not found
 *       409:
 *         description: Already published
 */
router.post('/:id/publish', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { seller, error } = await findSellerForUser(req.params.id as string, userId);
    if (error === 'NOT_FOUND') {
        res.status(404).json({ error: 'NOT_FOUND', message: `Business ${req.params.id} not found` });
        return;
    }
    if (error === 'FORBIDDEN') {
        res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied' });
        return;
    }

    if (seller!.status === 'active') {
        res.status(409).json({ error: 'ALREADY_PUBLISHED', message: 'This business is already active' });
        return;
    }

    // Validate minimum required fields before going live
    const missing: string[] = [];
    if (!seller!.name) missing.push('name');
    if (!seller!.serviceType) missing.push('serviceType');
    if (missing.length > 0) {
        res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: `Cannot publish: missing required fields: ${missing.join(', ')}`,
        });
        return;
    }

    try {
        const updated = await prisma.seller.update({
            where: { id: seller!.id },
            data: { status: 'active', publishedAt: new Date() },
        });

        res.status(200).json(formatBusiness(updated));
    } catch (err) {
        console.error('Error publishing business:', err);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/businesses/:id  — partial update / "Save & Continue Later"
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/businesses/{id}:
 *   patch:
 *     summary: Partial update — Save & Continue Later
 *     description: Accepts any subset of Step 1 or Step 2 fields. Status remains "draft" until /publish is called.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Updated business draft
 *       400:
 *         description: Validation error
 *       404:
 *         description: Not found
 */
router.patch('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { seller, error } = await findSellerForUser(req.params.id as string, userId);
    if (error === 'NOT_FOUND') {
        res.status(404).json({ error: 'NOT_FOUND', message: `Business ${req.params.id} not found` });
        return;
    }
    if (error === 'FORBIDDEN') {
        res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied' });
        return;
    }

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
        const first = parsed.error.issues[0];
        res.status(400).json({ error: 'VALIDATION_ERROR', message: first.message });
        return;
    }

    const {
        name, tagline, location, latitude, longitude, city, state,
        serviceType, categories, avatar,
        bio, workPhotos, businessLicense, delivery, sampling, orderCapDollars,
    } = parsed.data;

    const avatarUrl = resolveImageField(avatar, `avatar-${seller!.id}`);
    const resolvedPhotos = resolveImageArray(workPhotos, `work-${seller!.id}`);

    try {
        const updated = await prisma.seller.update({
            where: { id: seller!.id },
            data: {
                ...(name !== undefined && { name, description: name }),
                ...(tagline !== undefined && { tagline }),
                ...(location !== undefined && { location }),
                ...(latitude !== undefined && { latitude }),
                ...(longitude !== undefined && { longitude }),
                ...(city !== undefined && { city }),
                ...(state !== undefined && { state }),
                ...(serviceType !== undefined && { serviceType }),
                ...(categories !== undefined && { categories }),
                ...(avatar !== undefined && { avatarUrl }),
                ...(bio !== undefined && { bio }),
                ...(workPhotos !== undefined && { workPhotos: resolvedPhotos }),
                ...(businessLicense !== undefined && { businessLicense }),
                ...(delivery !== undefined && {
                    delivery: delivery.available,
                    deliveryRadiusMiles: delivery.radiusMiles ?? null,
                }),
                ...(sampling !== undefined && {
                    samplesPerMonth: sampling.available ? (sampling.samplesPerMonth ?? 1) : 0,
                }),
                ...(orderCapDollars !== undefined && { orderCapDollars }),
            },
        });

        res.status(200).json(formatBusiness(updated));
    } catch (err) {
        console.error('Error patching business:', err);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/businesses/:id/avatar  — dedicated avatar upload (multipart)
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/businesses/{id}/avatar:
 *   post:
 *     summary: Upload business avatar image
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar URL
 */
router.post('/:id/avatar', authenticateToken, upload.single('avatar'), async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    if (!req.file) { res.status(400).json({ error: 'VALIDATION_ERROR', message: 'avatar file is required' }); return; }

    const { seller, error } = await findSellerForUser(req.params.id as string, userId);
    if (error === 'NOT_FOUND') {
        res.status(404).json({ error: 'NOT_FOUND', message: `Business ${req.params.id} not found` });
        return;
    }
    if (error === 'FORBIDDEN') {
        res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied' });
        return;
    }

    const avatarUrl = `/uploads/${req.file.filename}`;
    await prisma.seller.update({ where: { id: seller!.id }, data: { avatarUrl } });

    res.status(200).json({ avatarUrl });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/businesses/:id/work-photos  — upload work photos (up to 5)
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/businesses/{id}/work-photos:
 *   post:
 *     summary: Upload work photos (max 5)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photos:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Work photo URLs
 */
router.post('/:id/work-photos', authenticateToken, upload.array('photos', 5), async (req: Request, res: Response): Promise<void> => {
    const userId = getUserId(req);
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'At least one photo is required' });
        return;
    }

    const { seller, error } = await findSellerForUser(req.params.id as string, userId);
    if (error === 'NOT_FOUND') {
        res.status(404).json({ error: 'NOT_FOUND', message: `Business ${req.params.id} not found` });
        return;
    }
    if (error === 'FORBIDDEN') {
        res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied' });
        return;
    }

    const newUrls = files.map((f) => `/uploads/${f.filename}`);
    const combined = [...(seller!.workPhotos ?? []), ...newUrls].slice(0, 10); // cap at 10

    await prisma.seller.update({ where: { id: seller!.id }, data: { workPhotos: combined } });

    res.status(200).json({ workPhotos: combined });
});

export default router;
