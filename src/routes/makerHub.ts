import { Router, Request, Response } from 'express';
import { prisma } from '../context';
import { authenticateToken } from '../middleware/auth';

const router = Router();

const handlePickupsRequest = async (req: Request, res: Response, isToday: boolean) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const sellerIdParam = req.params.sellerId;

    const seller = await prisma.seller.findUnique({ where: { userId } });
    if (!seller) {
      res.status(403).json({ error: 'Only sellers can access this endpoint' });
      return;
    }

    if (sellerIdParam && seller.id !== sellerIdParam) {
      res.status(403).json({ error: 'Forbidden: You can only access your own pickups' });
      return;
    }

    // Determine requested date target string
    let targetDateStr = '';
    if (isToday) {
      targetDateStr = new Date().toISOString().split('T')[0];
    } else {
      targetDateStr = (req.query.date as string) || '';
    }

    // We fetch Orders that have been placed and accepted
    const orders = await prisma.order.findMany({
      where: {
        sellerId: seller.id,
        status: { notIn: ['pending', 'collected', 'rejected', 'cancelled'] },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        items: {
          include: {
            product: true,
            deliveryHistory: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
        orderChanges: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const filteredOrders = orders.filter((order) => {
      if (!targetDateStr) return true; // Returns all orders if no date was specified

      const timeSlot = order.pickupDate || '';
      const dateStr = targetDateStr.split('T')[0];
      const daysToLookAhead = isToday ? 1 : parseInt(req.query.days as string, 10) || 1;

      // Generate sequence of acceptable dates
      const validDates: string[] = [];
      const baseDate = new Date(`${dateStr}T12:00:00Z`);
      for (let i = 0; i < daysToLookAhead; i++) {
        const tempDate = new Date(baseDate);
        tempDate.setDate(tempDate.getDate() + i);
        validDates.push(tempDate.toISOString().split('T')[0]); // "YYYY-MM-DD"
      }

      // Check explicit mapping
      if (order.pickupDate && validDates.includes(order.pickupDate)) return true;

      // Optional Fallback parsing for legacy rows
      for (const validD of validDates) {
        const parts = validD.split('-');
        const monthIndex = parseInt(parts[1], 10) - 1;
        const dayNum = parseInt(parts[2], 10).toString();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dateSubstr = `${months[monthIndex]} ${dayNum}`; // e.g. "Mar 24"
        if (timeSlot.includes(dateSubstr)) return true;
      }

      // Also unconditionally return Active/Placed orders that might be overdue
      if (
        [
          'placed',
          'accepted',
          'ready',
          'maker_requested_change',
          'CHANGES_REQUESTED',
          'APPROVED',
          'IN_PROGRESS',
          'READY_FOR_PICKUP',
        ].includes(order.status)
      ) {
        return true;
      }

      return false;
    });

    const transformedOrders = filteredOrders.map((order: any) => {
      // Find latest proposed changes by seller to extract proposed dates
      const latestProposal = order.orderChanges?.find(
        (c: any) => c.changedBy === 'seller' && (c.proposedPickupDate || c.proposedPickupTime),
      );

      return {
        ...order,
        items: order.items.map((item: any) => ({
          ...item,
          originalPickupDate: item.pickupDate || order.pickupDate || null,
          originalpickupTime: item.pickupTime || order.pickupTime || null,
          proposedPickupDate: latestProposal?.proposedPickupDate || null,
          proposedPickupTime: latestProposal?.proposedPickupTime || null,
        })),
      };
    });

    console.dir(transformedOrders, { depth: null, colors: true });
    res.status(200).json(transformedOrders);
  } catch (err) {
    console.error('Error in Pickups API:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * @swagger
 * /api/sellers/{sellerId}/pickups/today:
 *   get:
 *     summary: Get today's pickups for the maker
 *     description: Returns the pickup schedule for today.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pickups payload
 */
router.get('/:sellerId/pickups/today', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  await handlePickupsRequest(req, res, true);
});

/**
 * @swagger
 * /api/sellers/{sellerId}/pickups:
 *   get:
 *     summary: Get pickups for the maker by date
 *     description: Returns the pickup schedule based on query parameters.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *         description: The date for pickups (e.g. 2026-02-16)
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *         description: Number of days to look ahead
 *     responses:
 *       200:
 *         description: Pickups payload
 */
router.get('/:sellerId/pickups', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  await handlePickupsRequest(req, res, false);
});

// ── Products ──────────────────────────────────────────────────────────────────

async function requireSellerOwnership(req: Request, res: Response): Promise<{ sellerId: string } | null> {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const seller = await prisma.seller.findUnique({ where: { userId } });
  if (!seller) {
    res.status(403).json({ error: 'Only sellers can access this endpoint' });
    return null;
  }
  const sellerId = req.params.sellerId as string;
  if (seller.id !== sellerId) {
    res.status(403).json({ error: 'Forbidden: You can only manage your own products' });
    return null;
  }
  return { sellerId: seller.id };
}

/**
 * @swagger
 * /api/sellers/{sellerId}/products:
 *   post:
 *     summary: Create a product for a seller
 *     security:
 *       - bearerAuth: []
 */
router.post('/:sellerId/products', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const ownership = await requireSellerOwnership(req, res);
    if (!ownership) return;

    const {
      name,
      title,
      description,
      price,
      stockQuantity,
      quantityAvailable,
      category,
      tags,
      badges,
      pickupWindows,
      pickupLocation,
    } = req.body;

    const productTitle = title ?? name;
    if (!productTitle || typeof productTitle !== 'string' || productTitle.trim().length === 0) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'name (or title) is required' });
      return;
    }
    if (!description || typeof description !== 'string') {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'description is required' });
      return;
    }
    if (price === undefined || typeof price !== 'number' || price < 0) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'price must be a non-negative number' });
      return;
    }

    const qty = quantityAvailable ?? stockQuantity ?? 1;

    const product = await prisma.product.create({
      data: {
        sellerId: ownership.sellerId,
        title: productTitle.trim(),
        description: description.trim(),
        price,
        quantityAvailable: qty,
        quantityLeft: qty,
        category: category ?? null,
        tags: Array.isArray(tags) ? tags : [],
        badges: Array.isArray(badges) ? badges : [],
        images: [],
        ...(pickupWindows !== undefined && { pickupWindows }),
        ...(pickupLocation !== undefined && { pickupLocation }),
      },
    });

    res.status(201).json(product);
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/sellers/{sellerId}/products:
 *   get:
 *     summary: List all products for a seller
 *     security:
 *       - bearerAuth: []
 */
router.get('/:sellerId/products', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const ownership = await requireSellerOwnership(req, res);
    if (!ownership) return;

    const products = await prisma.product.findMany({
      where: { sellerId: ownership.sellerId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json(products);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/sellers/{sellerId}/products/{productId}:
 *   get:
 *     summary: Get a single product by ID (for edit pre-fill)
 *     security:
 *       - bearerAuth: []
 */
router.get('/:sellerId/products/:productId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const ownership = await requireSellerOwnership(req, res);
    if (!ownership) return;

    const productId = req.params.productId as string;
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.sellerId !== ownership.sellerId) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    res.status(200).json(product);
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/sellers/{sellerId}/products/{productId}:
 *   patch:
 *     summary: Update a product
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  '/:sellerId/products/:productId',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const ownership = await requireSellerOwnership(req, res);
      if (!ownership) return;

      const productId = req.params.productId as string;
      const existing = await prisma.product.findUnique({ where: { id: productId } });
      if (!existing || existing.sellerId !== ownership.sellerId) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }

      const {
        name,
        title,
        description,
        price,
        currency,
        stockQuantity,
        quantityAvailable,
        category,
        tags,
        badges,
        pickupWindows,
        pickupLocation,
      } = req.body;

      const updateData: Record<string, unknown> = {};

      const productTitle = title ?? name;
      if (productTitle !== undefined) updateData.title = String(productTitle).trim();
      if (description !== undefined) updateData.description = String(description).trim();
      if (price !== undefined) updateData.price = price;
      if (currency !== undefined) updateData.currency = currency;
      if (category !== undefined) updateData.category = category;
      if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags : [];
      if (badges !== undefined) updateData.badges = Array.isArray(badges) ? badges : [];
      if (pickupWindows !== undefined) updateData.pickupWindows = pickupWindows;
      if (pickupLocation !== undefined) updateData.pickupLocation = pickupLocation;

      const newQty = quantityAvailable ?? stockQuantity;
      if (newQty !== undefined) {
        updateData.quantityAvailable = newQty;
        // Adjust quantityLeft by the same delta so in-flight orders aren't over-allocated
        const delta = newQty - existing.quantityAvailable;
        updateData.quantityLeft = Math.max(0, existing.quantityLeft + delta);
      }

      const product = await prisma.product.update({ where: { id: productId }, data: updateData });
      res.status(200).json(product);
    } catch (err) {
      console.error('Error updating product:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

/**
 * @swagger
 * /api/sellers/{sellerId}/products/{productId}:
 *   delete:
 *     summary: Delete a product
 *     security:
 *       - bearerAuth: []
 */
router.delete(
  '/:sellerId/products/:productId',
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const ownership = await requireSellerOwnership(req, res);
      if (!ownership) return;

      const productId = req.params.productId as string;
      const existing = await prisma.product.findUnique({ where: { id: productId } });
      if (!existing || existing.sellerId !== ownership.sellerId) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }

      await prisma.product.update({
        where: { id: productId },
        data: { isActive: false, deletedAt: new Date() },
      });
      res.status(204).send();
    } catch (err) {
      console.error('Error deleting product:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

/**
 * @swagger
 * /api/sellers/{sellerId}/analytics/trend:
 *   get:
 *     summary: Get order and revenue trend data for a seller
 *     description: Returns time-series trend data (orders + revenue) bucketed by granularity, plus a breakdown by order status for the selected period.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [30d, 60d, 3m, 12m]
 *           default: 30d
 *         description: 30d → daily, 60d → daily, 3m → weekly, 12m → monthly
 *     responses:
 *       200:
 *         description: Trend data and status breakdown
 *       400:
 *         description: Invalid period
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
router.get('/:sellerId/analytics/trend', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const ownership = await requireSellerOwnership(req, res);
    if (!ownership) return;

    const PERIOD_CONFIG: Record<string, { days: number; granularity: 'daily' | 'weekly' | 'monthly' }> = {
      '30d': { days: 30, granularity: 'daily' },
      '60d': { days: 60, granularity: 'daily' },
      '3m': { days: 90, granularity: 'weekly' },
      '12m': { days: 365, granularity: 'monthly' },
    };

    const period = (req.query.period as string) || '30d';
    const config = PERIOD_CONFIG[period];
    if (!config) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'period must be one of: 30d, 60d, 3m, 12m' });
      return;
    }

    const { days, granularity } = config;
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    startDate.setUTCHours(0, 0, 0, 0);

    const orders = await prisma.order.findMany({
      where: {
        sellerId: ownership.sellerId,
        createdAt: { gte: startDate },
      },
      select: { id: true, totalAmount: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // ── Bucket key helpers ──────────────────────────────────────────────────
    const bucketKey = (date: Date): string => {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');

      if (granularity === 'daily') return `${y}-${m}-${d}`;
      if (granularity === 'monthly') return `${y}-${m}`;
      // weekly → ISO week start (Monday)
      const day = date.getUTCDay(); // 0 Sun … 6 Sat
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(date);
      monday.setUTCDate(date.getUTCDate() + diff);
      const wy = monday.getUTCFullYear();
      const wm = String(monday.getUTCMonth() + 1).padStart(2, '0');
      const wd = String(monday.getUTCDate()).padStart(2, '0');
      return `${wy}-${wm}-${wd}`;
    };

    // ── Build complete bucket spine so gaps show as zero ────────────────────
    const spine: string[] = [];
    if (granularity === 'daily') {
      for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setUTCDate(startDate.getUTCDate() + i);
        spine.push(bucketKey(d));
      }
    } else if (granularity === 'weekly') {
      const cursor = new Date(startDate);
      const firstDay = cursor.getUTCDay();
      cursor.setUTCDate(cursor.getUTCDate() + (firstDay === 0 ? -6 : 1 - firstDay));
      while (cursor <= now) {
        spine.push(bucketKey(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 7);
      }
    } else {
      for (let i = 0; i < 12; i++) {
        const d = new Date(startDate);
        d.setUTCMonth(startDate.getUTCMonth() + i);
        const key = bucketKey(d);
        if (!spine.includes(key)) spine.push(key);
      }
    }

    const buckets: Record<string, { orderCount: number; revenue: number }> = {};
    for (const key of spine) buckets[key] = { orderCount: 0, revenue: 0 };

    // ── Accumulate orders into buckets ──────────────────────────────────────
    const statusCount: Record<string, number> = {};
    for (const order of orders) {
      const key = bucketKey(order.createdAt);
      if (buckets[key]) {
        buckets[key].orderCount += 1;
        buckets[key].revenue += order.totalAmount;
      }
      statusCount[order.status] = (statusCount[order.status] ?? 0) + 1;
    }

    const trend = spine.map((label) => ({
      label,
      orderCount: buckets[label].orderCount,
      revenue: parseFloat(buckets[label].revenue.toFixed(2)),
    }));

    res.status(200).json({
      period,
      granularity,
      startDate: startDate.toISOString().split('T')[0],
      endDate: now.toISOString().split('T')[0],
      trend,
      byStatus: statusCount,
    });
  } catch (err) {
    console.error('Error fetching seller analytics trend:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/sellers/{sellerId}/analytics:
 *   get:
 *     summary: Get analytics for a seller
 *     description: Returns revenue, order count, average order price, and samples-to-orders conversion for a given period.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sellerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [30d, 60d, 3m, 12m]
 *           default: 30d
 *         description: Lookback period — 30d, 60d, 3m (90 days), or 12m (365 days).
 *     responses:
 *       200:
 *         description: Analytics summary
 *       400:
 *         description: Invalid period
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Seller not found
 *       500:
 *         description: Internal server error
 */
router.get('/:sellerId/analytics', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const ownership = await requireSellerOwnership(req, res);
    if (!ownership) return;

    const PERIOD_DAYS: Record<string, number> = { '30d': 30, '60d': 60, '3m': 90, '12m': 365 };
    const period = (req.query.period as string) || '30d';
    const days = PERIOD_DAYS[period];
    if (!days) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'period must be one of: 30d, 60d, 3m, 12m' });
      return;
    }

    const sellerId = ownership.sellerId;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setUTCHours(0, 0, 0, 0);

    const COMPLETED_STATUSES = ['CLOSED', 'COMPLETED', 'completed'];

    const [orders, claimedSamples] = await Promise.all([
      prisma.order.findMany({
        where: {
          sellerId,
          status: { in: COMPLETED_STATUSES },
          createdAt: { gte: startDate },
        },
        select: { id: true, totalAmount: true },
      }),
      prisma.sample.findMany({
        where: {
          sellerId,
          status: 'claimed',
          claimedAt: { gte: startDate },
          claimedByUserId: { not: null },
        },
        select: { claimedByUserId: true, claimedAt: true },
      }),
    ]);

    // Revenue & order metrics
    const orderCount = orders.length;
    const revenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    const averageOrderPrice = orderCount > 0 ? revenue / orderCount : 0;

    // Samples → orders conversion:
    // Of customers who claimed a sample within the period,
    // how many went on to place a completed order with this seller after their claim?
    let ordersFromSamples = 0;
    if (claimedSamples.length > 0) {
      const conversionChecks = await Promise.all(
        claimedSamples.map(async (sample) => {
          const count = await prisma.order.count({
            where: {
              sellerId,
              customerId: sample.claimedByUserId!,
              status: { in: COMPLETED_STATUSES },
              createdAt: { gte: sample.claimedAt! },
            },
          });
          return count > 0 ? 1 : 0;
        }),
      );
      ordersFromSamples = conversionChecks.reduce((sum: number, v) => sum + v, 0);
    }

    const samplesClaimed = claimedSamples.length;
    const conversionRate = samplesClaimed > 0 ? parseFloat((ordersFromSamples / samplesClaimed).toFixed(2)) : 0;

    res.status(200).json({
      period,
      startDate: startDate.toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      revenue: parseFloat(revenue.toFixed(2)),
      orderCount,
      averageOrderPrice: parseFloat(averageOrderPrice.toFixed(2)),
      samplesConversion: {
        samplesClaimed,
        ordersFromSamples,
        conversionRate,
      },
    });
  } catch (err) {
    console.error('Error fetching seller analytics:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
