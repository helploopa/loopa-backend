import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../context';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { geocodeAddress } from '../services/geocodingService';
import { formatBusiness, deliveryZipcodesSchema } from './businessApi';

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
  deliveryZipcodes: deliveryZipcodesSchema.optional(),
  // Lead contact details, stored in BusinessLead
  website: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() && !/^https?:\/\//i.test(v.trim()) ? `https://${v.trim()}` : v),
    z.string().trim().url('website must be a valid URL').max(500).optional()
  ),
  email: z.string().trim().email('email must be a valid email address').max(200).optional(),
  phone: z.string().trim().min(7, 'phone is too short').max(30).optional(),
  // Accepts "@handle", "handle" or an instagram.com profile URL; stores the bare handle
  instagram: z.preprocess(
    (v) =>
      typeof v === 'string'
        ? v.trim().replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '')
        : v,
    z
      .string()
      .regex(/^[A-Za-z0-9._]{1,30}$/, 'instagram must be a valid Instagram handle')
      .optional()
  ),
});

const SELLER_STATUSES = ['unclaimed', 'draft', 'review', 'submitted', 'active'] as const;

const listQuerySchema = z.object({
  status: z.enum(SELLER_STATUSES).optional(),
});

type LeadContact = { website: string | null; email: string | null; phone: string | null; instagram: string | null };

function formatLead(lead: LeadContact | null) {
  return lead ? { website: lead.website, email: lead.email, phone: lead.phone, instagram: lead.instagram } : null;
}

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
 *         description: Up to 200 businesses, newest first. Each includes a `lead` object (website, email, phone, instagram) or null.
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
      include: { lead: true },
    });
    res.json(sellers.map((s) => ({ ...formatBusiness(s), lead: formatLead(s.lead) })));
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
 *       possible; if geocoding fails the business is still created, at 0,0. The website, contact
 *       email/phone and Instagram handle are saved as a BusinessLead linked to the business.
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
 *               deliveryZipcodes: { type: array, items: { type: string }, description: 'Zip codes the business delivers to' }
 *               website: { type: string, description: 'https:// is added if missing' }
 *               email: { type: string }
 *               phone: { type: string }
 *               instagram: { type: string, description: 'Handle, @handle or instagram.com URL; stored without the @' }
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

  const { name, tagline, serviceType, categories, city, state, zipcode, deliveryZipcodes, website, email, phone, instagram } =
    parsed.data;

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
        ...(deliveryZipcodes?.length && { delivery: true, deliveryZipcodes }),
        serviceType: serviceType ?? null,
        categories: categories ?? [],
        status: 'unclaimed',
        lead: {
          create: {
            website: website ?? null,
            email: email ?? null,
            phone: phone ?? null,
            instagram: instagram ?? null,
            enrolledByUserId: (req.user?.userId as string) ?? null,
          },
        },
      },
      include: { lead: true },
    });
    res.status(201).json({ ...formatBusiness(seller), lead: formatLead(seller.lead) });
  } catch (err) {
    console.error('Error enrolling business:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
});

export default router;
