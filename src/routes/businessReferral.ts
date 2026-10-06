import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../context';
import { authenticateApiKey, authenticateToken } from '../middleware/auth';
import { startBusinessOnboarding } from '../services/businessOnboarding';

const router = Router();

// ── Zod schema ────────────────────────────────────────────────────────────────

const referralSchema = z
  .object({
    businessName: z.string().trim().min(1).max(200).optional(),
    businessUrl: z
      .string()
      .trim()
      .transform((url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`))
      .pipe(z.string().url().max(500))
      .optional(),
    email: z.string().trim().email(),
    phone: z.string().trim().min(1).max(30).optional(),
    zipcode: z.string().trim().min(1).max(20).optional(),
  })
  .refine((data) => !!data.businessName || !!data.businessUrl, {
    message: 'Either businessName or businessUrl is required',
    path: ['businessName'],
  });

const REFERRAL_STATUSES = ['pending', 'contacted', 'onboarded', 'rejected', 'duplicate'] as const;

const statusUpdateSchema = z.object({ status: z.enum(REFERRAL_STATUSES) }).strict();

// Every referral can make Loopa email an address the referrer typed in, so cap how many a
// user can send and never email the same address twice in the cooldown window.
const DAILY_REFERRAL_LIMIT = 10;
const REPEAT_EMAIL_COOLDOWN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function getUserId(req: Request): string | null {
  return (req.user?.userId as string) ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/business-referrals — refer a neighbour business
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/business-referrals:
 *   post:
 *     summary: Refer a neighbour business
 *     description: >
 *       Lets a customer refer a business they know. Either `businessName` or
 *       `businessUrl` must be provided. The referring user is taken from the
 *       bearer token. Referrals with a website are handed to the n8n onboarding
 *       workflow, which verifies the site, creates the unclaimed business and
 *       emails the owner a claim link; referrals without one are sent as an
 *       invite email linking to /join. A user can refer at most 10 businesses a
 *       day, and an email already contacted in the last 30 days is saved with
 *       status "duplicate" without being emailed again.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               businessName:
 *                 type: string
 *               businessUrl:
 *                 type: string
 *                 description: Scheme optional — "www.example.com" is normalised to https://
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               zipcode:
 *                 type: string
 *     responses:
 *       201:
 *         description: Referral saved
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Daily referral limit reached
 *       500:
 *         description: Internal server error
 */
router.post('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = referralSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({ error: 'VALIDATION_ERROR', message: first.message });
    return;
  }

  const { businessName, businessUrl, email, phone, zipcode } = parsed.data;

  try {
    const now = Date.now();
    const sentToday = await prisma.referbusiness.count({
      where: { referredByUserId: userId, createdAt: { gte: new Date(now - DAY_MS) } },
    });
    if (sentToday >= DAILY_REFERRAL_LIMIT) {
      res.status(429).json({
        error: 'TOO_MANY_REFERRALS',
        message: `You can refer up to ${DAILY_REFERRAL_LIMIT} businesses a day. Try again tomorrow.`,
      });
      return;
    }

    const alreadyContacted = await prisma.referbusiness.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        status: { in: ['pending', 'contacted', 'onboarded'] },
        createdAt: { gte: new Date(now - REPEAT_EMAIL_COOLDOWN_DAYS * DAY_MS) },
      },
      select: { id: true },
    });

    const referral = await prisma.referbusiness.create({
      data: {
        referredByUserId: userId,
        businessName: businessName ?? null,
        businessUrl: businessUrl ?? null,
        email,
        phone: phone ?? null,
        zipcode: zipcode ?? null,
        status: alreadyContacted ? 'duplicate' : 'pending',
      },
    });
    if (!alreadyContacted) await startBusinessOnboarding(referral);
    res.status(201).json(referral);
  } catch (error) {
    console.error('Error creating business referral:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/business-referrals/:id — update referral status (service only)
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/business-referrals/{id}:
 *   patch:
 *     summary: Update a referral's status (service only)
 *     description: Called by the n8n onboarding workflow, e.g. to mark a referral "contacted" once the invite email is sent. Requires the x-api-key service token.
 *     security:
 *       - apiKeyAuth: []
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
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, contacted, onboarded, rejected, duplicate]
 *     responses:
 *       200:
 *         description: The updated referral
 *       400:
 *         description: Validation error
 *       401:
 *         description: Invalid or missing API key
 *       404:
 *         description: Referral not found
 */
router.patch('/:id', authenticateApiKey, async (req: Request, res: Response): Promise<void> => {
  const parsed = statusUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    res.status(400).json({ error: 'VALIDATION_ERROR', message: first.message });
    return;
  }

  try {
    const existing = await prisma.referbusiness.findUnique({ where: { id: req.params.id as string } });
    if (!existing) {
      res.status(404).json({ error: 'NOT_FOUND', message: `Referral ${req.params.id} not found` });
      return;
    }
    // Once the owner has added their business, a late "contacted" from n8n must not undo it.
    if (existing.status === 'onboarded' && parsed.data.status !== 'onboarded') {
      res.status(200).json(existing);
      return;
    }
    const referral = await prisma.referbusiness.update({ where: { id: existing.id }, data: { status: parsed.data.status } });
    res.status(200).json(referral);
  } catch (error) {
    console.error('Error updating business referral:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
