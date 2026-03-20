import { Router, Request, Response } from 'express';
import { prisma } from '../context';
import { authenticateToken } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/{seller_id}/orders/review:
 *   get:
 *     summary: Get placed orders to review for a seller
 *     description: Returns all orders with status "placed" waiting for seller review.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: seller_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of placed orders
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Not the seller)
 *       404:
 *         description: Seller not found
 *       500:
 *         description: Internal server error
 */
router.get('/:seller_id/orders/review', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    try {
        const sellerId = req.params.seller_id as string;
        const userId = req.user?.userId;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
        if (!seller) {
            res.status(404).json({ error: 'Seller not found' });
            return;
        }

        // Ensure the authenticated user owns this seller profile
        if (seller.userId !== userId) {
            res.status(403).json({ error: 'Forbidden: You can only view your own orders' });
            return;
        }

        const placedOrders = await prisma.order.findMany({
            where: {
                sellerId: sellerId,
                status: 'placed'
            },
            include: {
                items: {
                    include: {
                        product: {
                            select: { id: true, title: true, price: true, primaryImage: true }
                        }
                    }
                },
                customer: {
                    select: { id: true, name: true }
                }
            },
            orderBy: { createdAt: 'asc' }
        });

        res.status(200).json(placedOrders);

    } catch (err) {
        console.error('Error fetching seller placed orders:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
