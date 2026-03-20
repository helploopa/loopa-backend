import { Router, Request, Response } from 'express';
import { prisma } from '../context';
import { authenticateToken } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * /api/orders/active:
 *   get:
 *     summary: Get active orders for the logged-in customer
 *     description: Retrieves the current active orders (pending carts, placed unfulfilled orders, or orders with changes requested) for the authenticated customer.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of active orders
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
router.get('/active', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    try {
        const customerId = req.user?.userId;

        if (!customerId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const activeOrders = await prisma.order.findMany({
            where: {
                customerId,
                status: {
                    in: ['pending', 'placed', 'CHANGES_REQUESTED']
                }
            },
            include: {
                items: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                title: true,
                                price: true,
                                images: true,
                                primaryImage: true,
                            }
                        }
                    }
                },
                seller: {
                    select: {
                        id: true,
                        name: true,
                        avatarUrl: true
                    }
                },
                orderChanges: {
                    where: {
                        newStatus: 'CHANGES_REQUESTED',
                        changedBy: 'seller'
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 1
                }
            },
            orderBy: { updatedAt: 'desc' }
        });

        res.status(200).json(activeOrders);

    } catch (error) {
        console.error('Error fetching active orders:', error);
        res.status(500).json({ error: 'Internal server error while fetching active orders.' });
    }
});

/**
 * @swagger
 * /api/orders/add-item:
 *   post:
 *     summary: Add an item to a cart or create a new order
 *     description: Automatically adds an item to an active cart for the specific seller, or creates a new active cart if one does not exist.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *             properties:
 *               productId:
 *                 type: string
 *               quantity:
 *                 type: integer
 *                 default: 1
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Item added successfully
 *       400:
 *         description: Missing required fields or insufficient stock
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Product not found
 *       500:
 *         description: Internal server error
 */
// Logic: Automatically adds an item to an active cart for the specific seller, or creates a new active cart.
router.post('/add-item', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    try {
        const { productId, quantity = 1 } = req.body;

        if (!productId) {
            res.status(400).json({ error: 'productId is required' });
            return;
        }

        // Uses the authenticated user id from the JWT token
        const customerId = req.user?.userId;
        if (!customerId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        // 1. Validate Product & Inventory
        const product = await prisma.product.findUnique({
            where: { id: productId },
            select: { id: true, price: true, sellerId: true, quantityLeft: true, title: true }
        });

        if (!product) {
            res.status(404).json({ error: 'Product not found' });
            return;
        }

        if (product.quantityLeft < quantity) {
            res.status(400).json({ error: `Not enough stock. Only ${product.quantityLeft} left.` });
            return;
        }

        // 2. Check for an active order for THIS seller and THIS customer
        let activeOrder = await prisma.order.findFirst({
            where: {
                customerId,
                sellerId: product.sellerId,
                status: 'pending'
            },
            include: {
                items: true
            }
        });

        // 3. Handle Existing vs New Order
        if (activeOrder) {
            // Existing Order Handling
            const existingItem = activeOrder.items.find(item => item.productId === productId);

            if (existingItem) {
                // Increment item quantity
                await prisma.orderItem.update({
                    where: { id: existingItem.id },
                    data: { quantity: existingItem.quantity + quantity }
                });
            } else {
                // Create new item in existing order
                await prisma.orderItem.create({
                    data: {
                        orderId: activeOrder.id,
                        productId: product.id,
                        quantity: quantity,
                        price: product.price
                    }
                });
            }

            // Update order total
            await prisma.order.update({
                where: { id: activeOrder.id },
                data: {
                    totalAmount: activeOrder.totalAmount + (product.price * quantity)
                }
            });

        } else {
            // New Order Handling
            activeOrder = await prisma.order.create({
                data: {
                    customerId,
                    sellerId: product.sellerId,
                    status: 'pending',
                    totalAmount: product.price * quantity,
                    items: {
                        create: [
                            {
                                productId: product.id,
                                quantity: quantity,
                                price: product.price
                            }
                        ]
                    }
                },
                include: { items: true } // Include to match type later if needed
            });
        }

        // Return the updated or newly created order representation
        const finalOrder = await prisma.order.findUnique({
            where: { id: activeOrder.id },
            include: {
                items: {
                    include: { product: { select: { title: true, price: true } } }
                },
                seller: { select: { name: true } }
            }
        });

        res.status(200).json({
            message: `Added ${quantity} of ${product.title} to cart.`,
            order: finalOrder
        });

    } catch (error) {
        console.error('Error in /add-item:', error);
        res.status(500).json({ error: 'Internal server error while adding item to cart.' });
    }
});

// Helper route to reset orders easily during testing (mock functionality)
router.delete('/reset', async (req: Request, res: Response): Promise<void> => {
    try {
        await prisma.orderItem.deleteMany();
        await prisma.order.deleteMany();
        res.status(200).json({ message: 'All pending orders and items reset.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
});

/**
 * @swagger
 * /api/orders/{id}/quantity:
 *   patch:
 *     summary: Update item quantity in an order
 *     description: Update quantity of an item. If quantity <= 0, remove the item. If order becomes empty, delete order.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID of the order
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *               - quantity
 *             properties:
 *               productId:
 *                 type: string
 *               quantity:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Quantity updated or item/order deleted
 *       400:
 *         description: Missing required fields
 *       404:
 *         description: Order or item not found
 *       500:
 *         description: Internal server error
 */
// Update quantity of an item. If quantity <= 0, remove the item. If order becomes empty, delete order.
router.patch('/:id/quantity', async (req: Request, res: Response): Promise<void> => {
    try {
        const orderId = req.params.id as string;
        const { productId, quantity } = req.body;

        if (quantity === undefined || !productId) {
            res.status(400).json({ error: 'productId and quantity are required' });
            return;
        }

        const activeOrder = await prisma.order.findUnique({
            where: { id: orderId },
            include: { items: true }
        });

        if (!activeOrder) {
            res.status(404).json({ error: 'Order not found' });
            return;
        }

        const existingItem = activeOrder.items.find((item: any) => item.productId === productId);

        if (!existingItem) {
            res.status(404).json({ error: 'Item not found in order' });
            return;
        }

        if (quantity <= 0) {
            await prisma.orderItem.delete({ where: { id: existingItem.id } });
        } else {
            await prisma.orderItem.update({
                where: { id: existingItem.id },
                data: { quantity, price: existingItem.price } // Recalculate if dynamic
            });
        }

        // Recalculate Total
        const updatedItems = await prisma.orderItem.findMany({ where: { orderId } });
        if (updatedItems.length === 0) {
            // Cart empty, delete order
            await prisma.order.delete({ where: { id: orderId } });
            res.status(200).json({ message: 'Order was empty and deleted.' });
            return;
        }

        const newTotal = updatedItems.reduce((acc: number, item: any) => acc + (item.price * item.quantity), 0);

        const finalOrder = await prisma.order.update({
            where: { id: orderId },
            data: { totalAmount: newTotal },
            include: { items: true }
        });

        res.status(200).json({ message: 'Quantity updated', order: finalOrder });
    } catch (err) {
        console.error('Error updating quantity:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/orders/{id}/item/{productId}:
 *   delete:
 *     summary: Remove an item from an order
 *     description: Explicitly remove an item. If order becomes empty, delete the order entirely.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID of the order
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID of the product item to remove
 *     responses:
 *       200:
 *         description: Item removed successfully
 *       404:
 *         description: Order not found
 *       500:
 *         description: Internal server error
 */
// Explicitly remove an item. If order becomes empty, delete order.
router.delete('/:id/item/:productId', async (req: Request, res: Response): Promise<void> => {
    try {
        const orderId = req.params.id as string;
        const productId = req.params.productId as string;

        const activeOrder = await prisma.order.findUnique({
            where: { id: orderId },
            include: { items: true }
        });

        if (!activeOrder) {
            res.status(404).json({ error: 'Order not found' });
            return;
        }

        const existingItem = activeOrder.items.find((item: any) => item.productId === productId);
        if (existingItem) {
            await prisma.orderItem.delete({ where: { id: existingItem.id } });
        }

        const updatedItems = await prisma.orderItem.findMany({ where: { orderId } });
        if (updatedItems.length === 0) {
            await prisma.order.delete({ where: { id: orderId } });
            res.status(200).json({ message: 'Item removed and empty order deleted.' });
            return;
        }

        const newTotal = updatedItems.reduce((acc: number, item: any) => acc + (item.price * item.quantity), 0);
        const finalOrder = await prisma.order.update({
            where: { id: orderId },
            data: { totalAmount: newTotal },
            include: { items: true }
        });

        res.status(200).json({ message: 'Item removed', order: finalOrder });

    } catch (err) {
        console.error('Error removing item:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/orders/{id}/place:
 *   post:
 *     summary: Place an order
 *     description: Submit a pending order/cart for review by the seller. Changes status from pending to placed.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID of the order
 *     responses:
 *       200:
 *         description: Order placed successfully
 *       400:
 *         description: Cannot place this order (empty or wrong status)
 *       404:
 *         description: Order not found
 *       500:
 *         description: Internal server error
 */
// Customer places the order (Status: pending -> placed)
router.post('/:id/place', async (req: Request, res: Response): Promise<void> => {
    try {
        const orderId = req.params.id as string;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { items: true }
        });

        if (!order) {
            res.status(404).json({ error: 'Order not found' });
            return;
        }

        if (order.status !== 'pending') {
            res.status(400).json({ error: `Cannot place an order with status: ${order.status}` });
            return;
        }

        if (order.items.length === 0) {
            res.status(400).json({ error: `Cannot place an empty order. Add items first.` });
            return;
        }

        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: { status: 'placed' }
        });

        res.status(200).json({ message: 'Order successfully placed. Waiting for seller confirmation.', order: updatedOrder });

    } catch (err) {
        console.error('Error placing order:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/orders/{id}/confirm:
 *   post:
 *     summary: Confirm an order
 *     description: For a seller to review and confirm a placed order. Changes status from placed to completed.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID of the order
 *     responses:
 *       200:
 *         description: Order confirmed successfully
 *       400:
 *         description: Cannot confirm this order (wrong status)
 *       404:
 *         description: Order not found
 *       500:
 *         description: Internal server error
 */
// Seller confirms the order (Status: placed -> completed)
router.post('/:id/confirm', async (req: Request, res: Response): Promise<void> => {
    try {
        const orderId = req.params.id as string;

        const order = await prisma.order.findUnique({
            where: { id: orderId }
        });

        if (!order) {
            res.status(404).json({ error: 'Order not found' });
            return;
        }

        if (order.status !== 'placed') {
            res.status(400).json({ error: `Cannot confirm an order with status: ${order.status}. Order must be placed first.` });
            return;
        }

        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: { status: 'completed' }
        });

        res.status(200).json({ message: 'Order successfully confirmed by seller!', order: updatedOrder });

    } catch (err) {
        console.error('Error confirming order:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// NEW WORKFLOW ENDPOINTS (SELLER ACTIONS)
// ==========================================

/**
 * @swagger
 * /api/orders/{id}/approve:
 *   post:
 *     summary: Seller approves an order
 *     description: Seller accepts the order as-is without changes. Status becomes APPROVED.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Order approved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Not the seller)
 *       404:
 *         description: Order not found
 */
router.post('/:id/approve', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    try {
        const orderId = req.params.id as string;
        const userId = req.user?.userId;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const seller = await prisma.seller.findUnique({ where: { userId } });
        if (!seller) {
            res.status(403).json({ error: 'Only sellers can perform this action' });
            return;
        }

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) {
            res.status(404).json({ error: 'Order not found' });
            return;
        }

        if (order.sellerId !== seller.id) {
            res.status(403).json({ error: 'You are not the seller of this order' });
            return;
        }

        if (order.status !== 'placed') {
            res.status(400).json({ error: `Cannot approve order from status: ${order.status}` });
            return;
        }

        const updatedOrder = await prisma.$transaction(async (tx) => {
            const up = await tx.order.update({
                where: { id: orderId },
                data: { status: 'APPROVED' }
            });

            await tx.orderChange.create({
                data: {
                    orderId,
                    changedBy: 'seller',
                    previousStatus: order.status,
                    newStatus: 'APPROVED',
                    comments: 'Order accepted as-is.'
                }
            });

            return up;
        });

        // In a real app, send a notification here

        res.status(200).json({ message: 'Order approved successfully.', order: updatedOrder });

    } catch (err) {
        console.error('Error approving order:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/orders/{id}/propose-changes:
 *   patch:
 *     summary: Seller proposes changes to an order
 *     description: Seller requests changes (e.g., new pickup time). Status becomes CHANGES_REQUESTED.
 *     security:
 *       - bearerAuth: []
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
 *             required:
 *               - reason
 *             properties:
 *               proposedPickupDate:
 *                 type: string
 *               proposedPickupTime:
 *                 type: string
 *               reason:
 *                 type: string
 *               sellerComments:
 *                 type: string
 *     responses:
 *       200:
 *         description: Changes proposed
 *       400:
 *         description: Bad request (missing reason)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.patch('/:id/propose-changes', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    try {
        const orderId = req.params.id as string;
        const userId = req.user?.userId;
        const { proposedPickupDate, proposedPickupTime, reason, sellerComments } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!reason) {
            res.status(400).json({ error: 'Reason for changes must be provided.' });
            return;
        }

        const seller = await prisma.seller.findUnique({ where: { userId } });
        if (!seller) {
            res.status(403).json({ error: 'Only sellers can perform this action' });
            return;
        }

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) {
            res.status(404).json({ error: 'Order not found' });
            return;
        }

        if (order.sellerId !== seller.id) {
            res.status(403).json({ error: 'You are not the seller of this order' });
            return;
        }

        // Usually allow proposing changes from 'placed' or adjusting previous terms
        if (order.status !== 'placed' && order.status !== 'CHANGES_REQUESTED') {
            res.status(400).json({ error: `Cannot propose changes from status: ${order.status}` });
            return;
        }

        const updatedOrder = await prisma.$transaction(async (tx) => {
            const up = await tx.order.update({
                where: { id: orderId },
                data: { status: 'CHANGES_REQUESTED' }
            });

            await tx.orderChange.create({
                data: {
                    orderId,
                    changedBy: 'seller',
                    previousStatus: order.status,
                    newStatus: 'CHANGES_REQUESTED',
                    proposedPickupDate,
                    proposedPickupTime,
                    reason,
                    comments: sellerComments
                }
            });

            return up;
        });

        // In a real app, notify customer

        res.status(200).json({ message: 'Changes proposed. Awaiting customer review.', order: updatedOrder });

    } catch (err) {
        console.error('Error proposing changes:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// NEW WORKFLOW ENDPOINTS (CUSTOMER ACTIONS)
// ==========================================

/**
 * @swagger
 * /api/orders/{id}/review-changes:
 *   patch:
 *     summary: Customer reviews proposed changes
 *     description: Customer can approve or decline the changes proposed by the seller.
 *     security:
 *       - bearerAuth: []
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
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [approve, decline]
 *               comments:
 *                 type: string
 *     responses:
 *       200:
 *         description: Review submitted successfully
 *       400:
 *         description: Bad request (invalid action or order status)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Not the customer)
 *       404:
 *         description: Order not found
 */
router.patch('/:id/review-changes', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    try {
        const orderId = req.params.id as string;
        const userId = req.user?.userId;
        const { action, comments } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (action !== 'approve' && action !== 'decline') {
            res.status(400).json({ error: 'Action must be "approve" or "decline"' });
            return;
        }

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) {
            res.status(404).json({ error: 'Order not found' });
            return;
        }

        if (order.customerId !== userId) {
            res.status(403).json({ error: 'You are not the customer of this order' });
            return;
        }

        if (order.status !== 'CHANGES_REQUESTED') {
            res.status(400).json({ error: `Cannot review changes from status: ${order.status}` });
            return;
        }

        const latestProposal = await prisma.orderChange.findFirst({
            where: { orderId, changedBy: 'seller', newStatus: 'CHANGES_REQUESTED' },
            orderBy: { createdAt: 'desc' }
        });

        const newOrderStatus = action === 'approve' ? 'APPROVED' : 'DECLINED';

        const updatedOrder = await prisma.$transaction(async (tx) => {

            // If approved, parse the latest proposals to merge into pickupData or similar logic
            let pickupDataUpdate = order.pickupData as any || {};
            if (action === 'approve' && latestProposal) {
                if (latestProposal.proposedPickupDate) pickupDataUpdate.pickupDate = latestProposal.proposedPickupDate;
                if (latestProposal.proposedPickupTime) pickupDataUpdate.pickupTime = latestProposal.proposedPickupTime;
            }

            const up = await tx.order.update({
                where: { id: orderId },
                data: {
                    status: newOrderStatus,
                    ...(action === 'approve' ? { pickupData: pickupDataUpdate } : {})
                }
            });

            await tx.orderChange.create({
                data: {
                    orderId,
                    changedBy: 'customer',
                    previousStatus: order.status,
                    newStatus: newOrderStatus,
                    comments: comments || `${action.charAt(0).toUpperCase() + action.slice(1)}d seller changes.`
                }
            });

            return up;
        });

        // In a real app, send a notification to the seller here

        res.status(200).json({ message: `Changes ${newOrderStatus.toLowerCase()}`, order: updatedOrder });

    } catch (err) {
        console.error('Error reviewing changes:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// NEW WORKFLOW ENDPOINTS (FULFILLMENT)
// ==========================================

/**
 * @swagger
 * /api/orders/{id}/delivery-status:
 *   post:
 *     summary: Seller updates delivery/fulfillment status
 *     description: Tracks fulfillment stages (IN_PROGRESS, READY_FOR_PICKUP, COMPLETED)
 *     security:
 *       - bearerAuth: []
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
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [IN_PROGRESS, READY_FOR_PICKUP, COMPLETED, CANCELLED]
 *               pickupAddress:
 *                 type: string
 *               pickupTimeWindow:
 *                 type: string
 *               comments:
 *                 type: string
 *     responses:
 *       200:
 *         description: Delivery status updated
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Not the seller)
 *       404:
 *         description: Order not found
 */
router.post('/:id/delivery-status', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    try {
        const orderId = req.params.id as string;
        const userId = req.user?.userId;
        const { status, pickupAddress, pickupTimeWindow, comments } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const validStatuses = ['IN_PROGRESS', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED'];
        if (!validStatuses.includes(status)) {
            res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
            return;
        }

        const seller = await prisma.seller.findUnique({ where: { userId } });
        if (!seller) {
            res.status(403).json({ error: 'Only sellers can perform this action' });
            return;
        }

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) {
            res.status(404).json({ error: 'Order not found' });
            return;
        }

        if (order.sellerId !== seller.id) {
            res.status(403).json({ error: 'You are not the seller of this order' });
            return;
        }

        // Normally delivery only happens after approval
        if (order.status !== 'APPROVED' && order.status !== 'CLOSED' && order.status !== 'CANCELLED') {
            res.status(400).json({ error: `Cannot update delivery status for order in state: ${order.status}` });
            return;
        }

        const updatedOrder = await prisma.$transaction(async (tx) => {
            // Log delivery status
            await tx.orderDeliveryStatus.create({
                data: {
                    orderId,
                    status,
                    updatedBy: 'seller',
                    pickupAddress,
                    pickupTimeWindow,
                    comments
                }
            });

            // If fulfillment is marked completed, the main order lifecycle is closed
            if (status === 'COMPLETED') {
                return await tx.order.update({
                    where: { id: orderId },
                    data: { status: 'CLOSED' }
                });
            }

            return order;
        });

        res.status(200).json({ message: `Delivery status updated to ${status}`, order: updatedOrder });

    } catch (err) {
        console.error('Error updating delivery status:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
