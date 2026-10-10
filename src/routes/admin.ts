import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../context';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { geocodeAddress } from '../services/geocodingService';
import { formatBusiness } from './businessApi';

const router = Router();

router.use(authenticateToken, requireAdmin);

// ── Zod schemas ──────────────────────────────────────────────────────────────

const enrollSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100),
  tagline: z.string().trim().max(200).optional(),
  serviceType: z.enum(['product', 'service']).optional(),
  categories: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  zipcode: z.string().trim().max(20).optional(),
});

const SELLER_STATUSES = ['unclaimed', 'draft', 'review', 'submitted', 'active'] as const;

const listQuerySchema = z.object({
  status: z.enum(SELLER_STATUSES).optional(),
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/admin/businesses  — list businesses, newest first
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/admin/businesses:
 *   get:
 *     summary: List businesses (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [unclaimed, draft, review, submitted, active]
 *     responses:
 *       200:
 *         description: Up to 200 businesses, newest first
 *       403:
 *         description: Signed-in user is not an admin
 */
router.get('/businesses', async (req: Request, res: Response): Promise<void> => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }

  try {
    const sellers = await prisma.seller.findMany({
      where: parsed.data.status ? { status: parsed.data.status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json(sellers.map(formatBusiness));
  } catch (err) {
    console.error('Error listing businesses for admin:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/admin/businesses  — enroll a business as unclaimed
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/admin/businesses:
 *   post:
 *     summary: Enroll a business as unclaimed (admin only)
 *     description: |
 *       Creates an orphan business with status "unclaimed" and no linked user. The owner takes it
 *       over later through the /claim/{businessId} link. City/state/zipcode are geocoded when
 *       possible; if geocoding fails the business is still created, at 0,0.
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
 *               name: { type: string }
 *               tagline: { type: string }
 *               serviceType: { type: string, enum: [product, service] }
 *               categories: { type: array, items: { type: string } }
 *               city: { type: string }
 *               state: { type: string }
 *               zipcode: { type: string }
 *     responses:
 *       201:
 *         description: Unclaimed business created
 *       400:
 *         description: Validation error
 *       403:
 *         description: Signed-in user is not an admin
 */
router.post('/businesses', async (req: Request, res: Response): Promise<void> => {
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0].message });
    return;
  }

  const { name, tagline, serviceType, categories, city, state, zipcode } = parsed.data;

  let latitude = 0;
  let longitude = 0;
  if (city || zipcode) {
    try {
      const geo = await geocodeAddress({ city, state, zipcode });
      latitude = geo.lat;
      longitude = geo.lng;
    } catch (err) {
      console.error(`Geocoding failed while enrolling "${name}":`, err);
    }
  }

  try {
    const seller = await prisma.seller.create({
      data: {
        userId: null,
        name,
        description: tagline ?? '',
        tagline: tagline ?? null,
        location: [city, state].filter(Boolean).join(', ') || null,
        latitude,
        longitude,
        city: city ?? null,
        state: state ?? null,
        zipcode: zipcode ?? null,
        serviceType: serviceType ?? null,
        categories: categories ?? [],
        status: 'unclaimed',
      },
    });
    res.status(201).json(formatBusiness(seller));
  } catch (err) {
    console.error('Error enrolling business:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
});

export default router;
