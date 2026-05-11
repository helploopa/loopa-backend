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
/**
 * @swagger
 * /api/{seller_id}/orders:
 *   get:
 *     summary: Get past orders for a seller
 *     description: Returns completed/closed/cancelled orders for the seller. Optionally filter by status or date.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: seller_id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [All, CLOSED, COMPLETED, CANCELLED, DECLINED]
 *         description: Order status filter. Omit or pass "All" for no filter.
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-04-28"
 *         description: Filter orders created on this date (YYYY-MM-DD, UTC).
 *     responses:
 *       200:
 *         description: List of past orders
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Not the seller)
 *       404:
 *         description: Seller not found
 *       500:
 *         description: Internal server error
 */
router.get('/:seller_id/orders', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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

    if (seller.userId !== userId) {
      res.status(403).json({ error: 'Forbidden: You can only view your own orders' });
      return;
    }

    const VALID_STATUSES = new Set(['ALL', 'CLOSED', 'COMPLETED', 'CANCELLED', 'DECLINED']);
    const { status, date } = req.query as { status?: string; date?: string };

    const rawStatus = status?.toUpperCase();
    if (rawStatus && !VALID_STATUSES.has(rawStatus)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid status. Must be one of: All, CLOSED, COMPLETED, CANCELLED, DECLINED',
      });
      return;
    }

    const statusFilter = rawStatus && rawStatus !== 'ALL' ? rawStatus : undefined;

    let dateFilter: { gte: Date; lt: Date } | undefined;
    if (date) {
      const start = new Date(date);
      if (isNaN(start.getTime())) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid date format. Use YYYY-MM-DD.' });
        return;
      }
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      dateFilter = { gte: start, lt: end };
    }

    const pastOrders = await prisma.order.findMany({
      where: {
        sellerId,
        ...(statusFilter
          ? { status: statusFilter }
          : { status: { in: ['CLOSED', 'COMPLETED', 'CANCELLED', 'DECLINED'] } }),
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, title: true, price: true, images: true, primaryImage: true },
            },
            deliveryHistory: {
              orderBy: { createdAt: 'asc' },
            },
            reviews: true,
          },
        },
        customer: {
          select: { id: true, name: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.status(200).json(pastOrders);
  } catch (err) {
    console.error('Error fetching seller past orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
        status: 'placed',
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, title: true, price: true, primaryImage: true },
            },
          },
        },
        customer: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.status(200).json(placedOrders);
  } catch (err) {
    console.error('Error fetching seller placed orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
