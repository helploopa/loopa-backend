import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../context';
import { authenticateApiKey } from '../middleware/auth';

// Service-to-service endpoints used by the n8n business-claim verification
// workflow. All routes require the x-api-key service token; the React app
// never calls these directly (it calls POST /api/businesses/:id/claim).
const router = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CLAIM_STATUSES = ['pending_verification', 'approved', 'rejected', 'expired', 'cancelled'] as const;

const createClaimSchema = z.object({
  source: z.string().min(1).max(100),
  businessId: z.string().min(1),
  userId: z.string().min(1),
  userEmail: z.string().email(),
  userPhone: z.string().max(30).nullish(),
  businessName: z.string().max(200).nullish(),
  businessWebsite: z.string().max(500).nullish(),
  emailOtpHash: z.string().max(500).nullish(),
  emailOtpExpiresAt: z.coerce.date().nullish(),
  emailOtpAttempts: z.number().int().min(0).optional(),
  emailVerified: z.boolean().optional(),
  phoneVerified: z.boolean().optional(),
  status: z.enum(CLAIM_STATUSES).optional(),
});

// Identity fields (source, businessId, userId) are fixed once the claim is created.
const updateClaimSchema = z
  .object({
    userEmail: z.string().email(),
    userPhone: z.string().max(30).nullable(),
    businessName: z.string().max(200).nullable(),
    businessWebsite: z.string().max(500).nullable(),
    emailOtpHash: z.string().max(500).nullable(),
    emailOtpExpiresAt: z.coerce.date().nullable(),
    emailOtpAttempts: z.number().int().min(0),
    emailVerified: z.boolean(),
    phoneVerified: z.boolean(),
    status: z.enum(CLAIM_STATUSES),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

function formatClaim(claim: any) {
  const { id, ...rest } = claim;
  return { claimId: id, ...rest };
}

function validationError(res: Response, error: z.ZodError) {
  const first = error.issues[0];
  const field = first.path.join('.');
  res.status(400).json({ error: 'VALIDATION_ERROR', message: field ? `${field}: ${first.message}` : first.message });
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/business-claims — start a claim verification
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/business-claims:
 *   post:
 *     summary: Create a business claim record (service only)
 *     description: Called by n8n when claim verification starts. Requires the x-api-key service token.
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [source, businessId, userId, userEmail]
 *             properties:
 *               source:
 *                 type: string
 *               businessId:
 *                 type: string
 *               userId:
 *                 type: string
 *               userEmail:
 *                 type: string
 *               userPhone:
 *                 type: string
 *               businessName:
 *                 type: string
 *               businessWebsite:
 *                 type: string
 *               emailOtpHash:
 *                 type: string
 *               emailOtpExpiresAt:
 *                 type: string
 *                 format: date-time
 *               emailOtpAttempts:
 *                 type: integer
 *                 default: 0
 *               emailVerified:
 *                 type: boolean
 *                 default: false
 *               phoneVerified:
 *                 type: boolean
 *                 default: false
 *               status:
 *                 type: string
 *                 enum: [pending_verification, approved, rejected, expired, cancelled]
 *                 default: pending_verification
 *     responses:
 *       201:
 *         description: Claim created — returns { claimId, status }
 *       400:
 *         description: Validation error
 *       401:
 *         description: Invalid or missing API key
 */
router.post('/', authenticateApiKey, async (req: Request, res: Response): Promise<void> => {
  const parsed = createClaimSchema.safeParse(req.body);
  if (!parsed.success) {
    validationError(res, parsed.error);
    return;
  }

  try {
    const claim = await prisma.businessClaim.create({ data: parsed.data });
    res.status(201).json({ claimId: claim.id, status: claim.status });
  } catch (error) {
    console.error('Error creating business claim:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/business-claims/:claimId — fetch a claim record
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/business-claims/{claimId}:
 *   get:
 *     summary: Get a business claim record (service only)
 *     description: Returns the full claim record, including the OTP hash and expiry. Requires the x-api-key service token.
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: claimId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The claim record with claimId
 *       401:
 *         description: Invalid or missing API key
 *       404:
 *         description: Claim not found
 */
router.get('/:claimId', authenticateApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const claim = await prisma.businessClaim.findUnique({ where: { id: req.params.claimId as string } });
    if (!claim) {
      res.status(404).json({ error: 'NOT_FOUND', message: `Claim ${req.params.claimId} not found` });
      return;
    }
    res.status(200).json(formatClaim(claim));
  } catch (error) {
    console.error('Error fetching business claim:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/business-claims/:claimId — partial update
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/business-claims/{claimId}:
 *   patch:
 *     summary: Partially update a business claim (service only)
 *     description: >
 *       Updates verification state — e.g. emailVerified, emailOtpAttempts, phoneVerified,
 *       a resent OTP (emailOtpHash, emailOtpExpiresAt, emailOtpAttempts), or status.
 *       source, businessId and userId cannot be changed. Requires the x-api-key service token.
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: claimId
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
 *               userEmail:
 *                 type: string
 *               userPhone:
 *                 type: string
 *               businessName:
 *                 type: string
 *               businessWebsite:
 *                 type: string
 *               emailOtpHash:
 *                 type: string
 *               emailOtpExpiresAt:
 *                 type: string
 *                 format: date-time
 *               emailOtpAttempts:
 *                 type: integer
 *               emailVerified:
 *                 type: boolean
 *               phoneVerified:
 *                 type: boolean
 *               status:
 *                 type: string
 *                 enum: [pending_verification, approved, rejected, expired, cancelled]
 *     responses:
 *       200:
 *         description: The updated claim record with claimId
 *       400:
 *         description: Validation error (including unknown or immutable fields)
 *       401:
 *         description: Invalid or missing API key
 *       404:
 *         description: Claim not found
 */
router.patch('/:claimId', authenticateApiKey, async (req: Request, res: Response): Promise<void> => {
  const parsed = updateClaimSchema.safeParse(req.body);
  if (!parsed.success) {
    validationError(res, parsed.error);
    return;
  }

  try {
    const existing = await prisma.businessClaim.findUnique({ where: { id: req.params.claimId as string } });
    if (!existing) {
      res.status(404).json({ error: 'NOT_FOUND', message: `Claim ${req.params.claimId} not found` });
      return;
    }

    const claim = await prisma.businessClaim.update({ where: { id: existing.id }, data: parsed.data });
    res.status(200).json(formatClaim(claim));
  } catch (error) {
    console.error('Error updating business claim:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  }
});

export default router;
