import { Router, Request, Response } from 'express';
import { prisma } from '../context';

const router = Router();

/**
 * @swagger
 * /seller/{id}:
 *   get:
 *     summary: Get a seller by ID
 *     description: Retrieves the detailed profile of a specific seller. Includes business hours, features, sample rules and categories.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID of the seller
 *     responses:
 *       200:
 *         description: Seller profile object
 *       404:
 *         description: Seller not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
        const id = req.params.id as string;
        const seller = await prisma.seller.findUnique({
            where: { id },
            include: {
                user: {
                    select: {
                        name: true,
                        email: true
                    }
                },
                businessHours: { orderBy: { dayCode: 'asc' } },
                features: { orderBy: { featureKey: 'asc' } },
            }
        });

        const reviewsAggregation = await prisma.orderReview.aggregate({
            where: {
                orderItem: {
                    product: {
                        sellerId: id
                    }
                }
            },
            _avg: {
                overallRating: true
            },
            _count: {
                id: true
            }
        });

        if (!seller) {
            res.status(404).json({ error: 'Seller not found' });
            return;
        }

        const { businessHours, features, ...rest } = seller as any;

        const payload = {
            ...rest,
            workPermit: seller.workPermit,
            delivery: seller.delivery,
            businessHours,
            features: features.map((f: any) => ({
                featureKey: f.featureKey,
                enabled: f.enabled,
                config: f.config ?? null,
            })),
            reviewsSummary: {
                average: reviewsAggregation._avg.overallRating || 0,
                count: reviewsAggregation._count.id
            }
        };

        res.status(200).json(payload);
    } catch (error) {
        console.error('Error fetching seller:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /seller/{id}:
 *   put:
 *     summary: Update a seller by ID
 *     description: Updates a seller's profile including business hours and features. Accepts partial updates — only provided fields are changed.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID of the seller
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               avatarUrl:
 *                 type: string
 *               coverPhoto:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               pickupDays:
 *                 type: string
 *               pickupStartTime:
 *                 type: string
 *               pickupEndTime:
 *                 type: string
 *               workPermit:
 *                 type: boolean
 *               delivery:
 *                 type: boolean
 *               businessHours:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     dayCode:
 *                       type: string
 *                       description: "M=Mon, U=Tue, W=Wed, T=Thu, F=Fri, S=Sat, X=Sun"
 *                     startTime:
 *                       type: string
 *                     endTime:
 *                       type: string
 *                     isOpen:
 *                       type: boolean
 *               features:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     featureKey:
 *                       type: string
 *                     enabled:
 *                       type: boolean
 *                     config:
 *                       type: object
 *     responses:
 *       200:
 *         description: Updated seller profile
 *       404:
 *         description: Seller not found
 *       500:
 *         description: Internal server error
 */
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
        const id = req.params.id as string;
        const { businessHours, features, user, reviewsSummary, ...sellerScalars } = req.body;

        // Allowed scalar fields (guard against accidentally setting internal fields)
        const allowedScalars = [
            'name', 'description', 'avatarUrl', 'coverPhoto',
            'latitude', 'longitude', 'city', 'state',
            'pickupDays', 'pickupStartTime', 'pickupEndTime',
            'workPermit', 'delivery',
        ];
        const updateData: Record<string, any> = {};
        for (const key of allowedScalars) {
            if (sellerScalars[key] !== undefined) {
                updateData[key] = sellerScalars[key];
            }
        }

        // Ensure seller exists
        const existing = await prisma.seller.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ error: 'Seller not found' });
            return;
        }

        // Update scalar fields
        if (Object.keys(updateData).length > 0) {
            await prisma.seller.update({ where: { id }, data: updateData });
        }

        // Upsert business hours (one row per dayCode per seller)
        if (Array.isArray(businessHours) && businessHours.length > 0) {
            await Promise.all(
                businessHours.map((bh: { dayCode: string; startTime: string; endTime: string; isOpen?: boolean }) =>
                    prisma.sellerBusinessHours.upsert({
                        where: { sellerId_dayCode: { sellerId: id, dayCode: bh.dayCode } },
                        create: {
                            sellerId: id,
                            dayCode: bh.dayCode,
                            startTime: bh.startTime,
                            endTime: bh.endTime,
                            isOpen: bh.isOpen ?? true,
                        },
                        update: {
                            startTime: bh.startTime,
                            endTime: bh.endTime,
                            isOpen: bh.isOpen ?? true,
                        },
                    })
                )
            );
        }

        // Upsert features (one row per featureKey per seller)
        if (Array.isArray(features) && features.length > 0) {
            await Promise.all(
                features.map((f: { featureKey: string; enabled: boolean; config?: any }) =>
                    prisma.sellerFeature.upsert({
                        where: { sellerId_featureKey: { sellerId: id, featureKey: f.featureKey } },
                        create: {
                            sellerId: id,
                            featureKey: f.featureKey,
                            enabled: f.enabled,
                            config: f.config ?? null,
                        },
                        update: {
                            enabled: f.enabled,
                            config: f.config ?? null,
                        },
                    })
                )
            );
        }

        // Return updated seller
        const updated = await prisma.seller.findUnique({
            where: { id },
            include: {
                user: { select: { name: true, email: true } },
                businessHours: { orderBy: { dayCode: 'asc' } },
                features: { orderBy: { featureKey: 'asc' } },
            }
        });

        const reviewsAggregation = await prisma.orderReview.aggregate({
            where: { orderItem: { product: { sellerId: id } } },
            _avg: { overallRating: true },
            _count: { id: true },
        });

        res.status(200).json({
            ...updated,
            reviewsSummary: {
                average: reviewsAggregation._avg.overallRating || 0,
                count: reviewsAggregation._count.id,
            }
        });
    } catch (error) {
        console.error('Error updating seller:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /seller/{id}/products:
 *   get:
 *     summary: Get products by seller ID
 *     description: Retrieves all products belonging to a specific seller, ordered by creation date desc.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID of the seller
 *     responses:
 *       200:
 *         description: An array of products
 *       404:
 *         description: Seller not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id/products', async (req: Request, res: Response): Promise<void> => {
    try {
        const id = req.params.id as string;

        // Ensure seller exists first
        const seller = await prisma.seller.findUnique({
            where: { id },
        });

        if (!seller) {
            res.status(404).json({ error: 'Seller not found' });
            return;
        }

        const products = await prisma.product.findMany({
            where: { sellerId: id },
            orderBy: { createdAt: 'desc' } // Optional: order by newest first
        });

        res.status(200).json(products);
    } catch (error) {
        console.error('Error fetching seller products:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
