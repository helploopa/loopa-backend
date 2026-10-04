import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../context';
import { authenticateToken } from '../middleware/auth';
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
 *       emails the owner a claim link.
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
    const referral = await prisma.referbusiness.create({
      data: {
        referredByUserId: userId,
        businessName: businessName ?? null,
        businessUrl: businessUrl ?? null,
        email,
        phone: phone ?? null,
        zipcode: zipcode ?? null,
      },
    });
    if (referral.businessUrl) await startBusinessOnboarding(referral);
    res.status(201).json(referral);
  } catch (error) {
    console.error('Error creating business referral:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
