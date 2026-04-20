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
                status: { notIn: ['pending', 'collected', 'rejected', 'cancelled'] }
            },
            include: {
                customer: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                items: {
                    include: { product: true }
                },
                orderChanges: {
                    orderBy: {
                        createdAt: 'desc'
                    }
                }
            },
            orderBy: { createdAt: 'asc' }
        });
        const filteredOrders = orders.filter(order => {
            if (!targetDateStr) return true; // Returns all orders if no date was specified

            const timeSlot = order.pickupDate || "";
            const dateStr = targetDateStr.split('T')[0];
            const daysToLookAhead = isToday ? 1 : (parseInt(req.query.days as string, 10) || 1);

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
                const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                const dateSubstr = `${months[monthIndex]} ${dayNum}`; // e.g. "Mar 24"
                if (timeSlot.includes(dateSubstr)) return true;
            }

            // Also unconditionally return Active/Placed orders that might be overdue
            if (['placed', 'accepted', 'ready', 'maker_requested_change', 'CHANGES_REQUESTED', 'APPROVED', 'IN_PROGRESS', 'READY_FOR_PICKUP'].includes(order.status)) {
                return true; 
            }

            return false;
        });

        const transformedOrders = filteredOrders.map((order: any) => {
            // Find latest proposed changes by seller to extract proposed dates
            const latestProposal = order.orderChanges?.find((c: any) => c.changedBy === 'seller' && (c.proposedPickupDate || c.proposedPickupTime));
            
            return {
                ...order,
                items: order.items.map((item: any) => ({
                    ...item,
                    originalPickupDate: item.pickupDate || order.pickupDate || null,
                    originalpickupTime: item.pickupTime || order.pickupTime || null,
                    proposedPickupDate: latestProposal?.proposedPickupDate || null,
                    proposedPickupTime: latestProposal?.proposedPickupTime || null
                }))
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

        const { name, title, description, price, stockQuantity, quantityAvailable, category, tags, badges } = req.body;

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
router.patch('/:sellerId/products/:productId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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
            name, title, description, price, currency,
            stockQuantity, quantityAvailable,
            category, tags, badges,
            pickupWindows, pickupLocation,
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
});

/**
 * @swagger
 * /api/sellers/{sellerId}/products/{productId}:
 *   delete:
 *     summary: Delete a product
 *     security:
 *       - bearerAuth: []
 */
router.delete('/:sellerId/products/:productId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
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
});

export default router;
