import { Router, Request, Response } from 'express';
import { prisma } from '../context';

const router = Router();

// Valid day codes
const VALID_DAY_CODES = new Set(['M', 'U', 'W', 'T', 'F', 'S', 'X']);

/**
 * Expand a weekOfDays string (e.g. "MUWTFSX") into an array of valid day codes.
 * M=Monday, U=Tuesday, W=Wednesday, T=Thursday, F=Friday, S=Saturday, X=Sunday
 */
function expandWeekOfDays(weekOfDays: string): string[] {
    return weekOfDays.split('').filter((c) => VALID_DAY_CODES.has(c));
}

/**
 * Upsert one SellerBusinessHours row per day code for the given seller.
 * All days share the same startTime / endTime from the business_hours block.
 */
async function upsertBusinessHours(
    sellerId: string,
    businessHours: { weekOfDays: string; startTime: string; endTime: string; isOpen?: boolean }
) {
    const dayCodes = expandWeekOfDays(businessHours.weekOfDays);
    await Promise.all(
        dayCodes.map((dayCode) =>
            (prisma as any).sellerBusinessHours.upsert({
                where: { sellerId_dayCode: { sellerId, dayCode } },
                create: {
                    sellerId,
                    dayCode,
                    startTime: businessHours.startTime,
                    endTime: businessHours.endTime,
                    isOpen: businessHours.isOpen ?? true,
                },
                update: {
                    startTime: businessHours.startTime,
                    endTime: businessHours.endTime,
                    isOpen: businessHours.isOpen ?? true,
                },
            })
        )
    );
}

/**
 * Upsert one SellerFeature row per feature key.
 * Input shape: { sampling: { enable: true, weekly_sample: 10 }, delivery: { ... } }
 * The `enable` property maps to `enabled`; the rest becomes the JSON `config`.
 */
async function upsertFeatures(
    sellerId: string,
    features: Record<string, { enable: boolean; [key: string]: any }>
) {
    await Promise.all(
        Object.entries(features).map(([featureKey, featureVal]) => {
            const { enable, ...config } = featureVal;
            return (prisma as any).sellerFeature.upsert({
                where: { sellerId_featureKey: { sellerId, featureKey } },
                create: { sellerId, featureKey, enabled: enable, config },
                update: { enabled: enable, config },
            });
        })
    );
}

/** Return the full seller payload with user, businessHours, and features included. */
async function getSellerPayload(id: string) {
    return (prisma as any).seller.findUnique({
        where: { id },
        include: {
            user: { select: { name: true, email: true } },
            businessHours: { orderBy: { dayCode: 'asc' } },
            features: { orderBy: { featureKey: 'asc' } },
        },
    });
}

// ---------------------------------------------------------------------------
// GET /business/:id — fetch current wizard state
// ---------------------------------------------------------------------------
/**
 * @swagger
 * /business/{id}:
 *   get:
 *     summary: Get business wizard state by seller ID
 *     description: Returns the current seller profile including business hours and features, useful for restoring wizard progress.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Seller/business profile
 *       404:
 *         description: Not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
        const id = req.params.id as string;
        const seller = await getSellerPayload(id);
        if (!seller) {
            res.status(404).json({ error: 'Business not found' });
            return;
        }
        res.status(200).json(seller);
    } catch (error) {
        console.error('Error fetching business:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// POST /business — Section 1: create business in draft
// ---------------------------------------------------------------------------
/**
 * @swagger
 * /business:
 *   post:
 *     summary: Wizard Section 1 — Create business (draft)
 *     description: >
 *       Creates a new seller/business profile in **draft** status.
 *       The `userId` must reference an existing User. `latitude` and `longitude`
 *       default to 0 until set in a later section.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, name, description]
 *             properties:
 *               userId:
 *                 type: string
 *               name:
 *                 type: string
 *               serviceType:
 *                 type: string
 *                 enum: [service, product]
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Business created in draft status
 *       400:
 *         description: Missing required fields or user not found
 *       409:
 *         description: A seller profile already exists for this user
 *       500:
 *         description: Internal server error
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId, name, serviceType, description } = req.body;

        if (!userId || !name || !description) {
            res.status(400).json({ error: 'userId, name, and description are required' });
            return;
        }

        // Verify user exists
        const user = await prisma.user.findUnique({ where: { id: userId as string } });
        if (!user) {
            res.status(400).json({ error: `User not found: ${userId}` });
            return;
        }

        // Check for existing seller
        const existing = await prisma.seller.findUnique({ where: { userId: userId as string } });
        if (existing) {
            res.status(409).json({
                error: 'A seller profile already exists for this user',
                sellerId: existing.id,
            });
            return;
        }

        const seller = await (prisma as any).seller.create({
            data: {
                userId,
                name,
                description,
                serviceType: serviceType ?? null,
                status: 'draft',
                latitude: 0,
                longitude: 0,
            },
            include: {
                user: { select: { name: true, email: true } },
                businessHours: true,
                features: true,
            },
        });

        res.status(201).json(seller);
    } catch (error) {
        console.error('Error creating business (section 1):', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// PUT /business/:id/section2 — Section 2: business details → review
// ---------------------------------------------------------------------------
/**
 * @swagger
 * /business/{id}/section2:
 *   put:
 *     summary: Wizard Section 2 — Add business details (review)
 *     description: >
 *       Adds `workPermit`, business hours, and feature flags to an existing draft business.
 *       The `weekOfDays` string is expanded character-by-character into individual day rows
 *       (M=Mon, U=Tue, W=Wed, T=Thu, F=Fri, S=Sat, X=Sun).
 *       Advances status to **review**.
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
 *               workPermit:
 *                 type: boolean
 *               business_hours:
 *                 type: object
 *                 properties:
 *                   weekOfDays:
 *                     type: string
 *                     example: "MUWTFSX"
 *                   startTime:
 *                     type: string
 *                     example: "10:00"
 *                   endTime:
 *                     type: string
 *                     example: "19:00"
 *               features:
 *                 type: object
 *                 description: Map of featureKey to feature config with an `enable` boolean
 *     responses:
 *       200:
 *         description: Business updated, status set to review
 *       404:
 *         description: Business not found
 *       500:
 *         description: Internal server error
 */
router.put('/:id/section2', async (req: Request, res: Response): Promise<void> => {
    try {
        const id = req.params.id as string;
        const { workPermit, business_hours, features } = req.body;

        const existing = await prisma.seller.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ error: 'Business not found' });
            return;
        }

        // Update scalar fields + advance status
        await (prisma as any).seller.update({
            where: { id },
            data: {
                ...(workPermit !== undefined && { workPermit }),
                status: 'review',
            },
        });

        // Upsert business hours
        if (business_hours?.weekOfDays) {
            await upsertBusinessHours(id, business_hours);
        }

        // Upsert features
        if (features && typeof features === 'object') {
            await upsertFeatures(id, features);
        }

        const updated = await getSellerPayload(id);
        res.status(200).json(updated);
    } catch (error) {
        console.error('Error updating business (section 2):', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------------------------------------------------------------------------
// PUT /business/:id/section3 — Section 3: final review → submitted
// ---------------------------------------------------------------------------
/**
 * @swagger
 * /business/{id}/section3:
 *   put:
 *     summary: Wizard Section 3 — Submit business
 *     description: >
 *       Accepts the same payload as Section 2 for any final changes, then advances
 *       the status to **submitted**.
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
 *               workPermit:
 *                 type: boolean
 *               business_hours:
 *                 type: object
 *               features:
 *                 type: object
 *     responses:
 *       200:
 *         description: Business submitted successfully
 *       404:
 *         description: Business not found
 *       500:
 *         description: Internal server error
 */
router.put('/:id/section3', async (req: Request, res: Response): Promise<void> => {
    try {
        const id = req.params.id as string;
        const { workPermit, business_hours, features } = req.body;

        const existing = await prisma.seller.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ error: 'Business not found' });
            return;
        }

        // Update scalar fields + advance status to submitted
        await (prisma as any).seller.update({
            where: { id },
            data: {
                ...(workPermit !== undefined && { workPermit }),
                status: 'submitted',
            },
        });

        // Upsert business hours (allow last-minute changes)
        if (business_hours?.weekOfDays) {
            await upsertBusinessHours(id, business_hours);
        }

        // Upsert features (allow last-minute changes)
        if (features && typeof features === 'object') {
            await upsertFeatures(id, features);
        }

        const updated = await getSellerPayload(id);
        res.status(200).json(updated);
    } catch (error) {
        console.error('Error submitting business (section 3):', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
