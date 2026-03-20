"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const context_1 = require("../context");
const router = (0, express_1.Router)();
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
router.post('/add-item', async (req, res) => {
    try {
        const { productId, quantity = 1 } = req.body;
        if (!productId) {
            res.status(400).json({ error: 'productId is required' });
            return;
        }
        // Mock Auth: Get the first dummy user as the authenticated customer
        const dummyUser = await context_1.prisma.user.findFirst();
        if (!dummyUser) {
            res.status(401).json({ error: 'Unauthorized (No mock user found)' });
            return;
        }
        const customerId = dummyUser.id;
        // 1. Validate Product & Inventory
        const product = await context_1.prisma.product.findUnique({
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
        let activeOrder = await context_1.prisma.order.findFirst({
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
                await context_1.prisma.orderItem.update({
                    where: { id: existingItem.id },
                    data: { quantity: existingItem.quantity + quantity }
                });
            }
            else {
                // Create new item in existing order
                await context_1.prisma.orderItem.create({
                    data: {
                        orderId: activeOrder.id,
                        productId: product.id,
                        quantity: quantity,
                        price: product.price
                    }
                });
            }
            // Update order total
            await context_1.prisma.order.update({
                where: { id: activeOrder.id },
                data: {
                    totalAmount: activeOrder.totalAmount + (product.price * quantity)
                }
            });
        }
        else {
            // New Order Handling
            activeOrder = await context_1.prisma.order.create({
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
        const finalOrder = await context_1.prisma.order.findUnique({
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
    }
    catch (error) {
        console.error('Error in /add-item:', error);
        res.status(500).json({ error: 'Internal server error while adding item to cart.' });
    }
});
// Helper route to reset orders easily during testing (mock functionality)
router.delete('/reset', async (req, res) => {
    try {
        await context_1.prisma.orderItem.deleteMany();
        await context_1.prisma.order.deleteMany();
        res.status(200).json({ message: 'All pending orders and items reset.' });
    }
    catch (err) {
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
router.patch('/:id/quantity', async (req, res) => {
    try {
        const orderId = req.params.id;
        const { productId, quantity } = req.body;
        if (quantity === undefined || !productId) {
            res.status(400).json({ error: 'productId and quantity are required' });
            return;
        }
        const activeOrder = await context_1.prisma.order.findUnique({
            where: { id: orderId },
            include: { items: true }
        });
        if (!activeOrder) {
            res.status(404).json({ error: 'Order not found' });
            return;
        }
        const existingItem = activeOrder.items.find((item) => item.productId === productId);
        if (!existingItem) {
            res.status(404).json({ error: 'Item not found in order' });
            return;
        }
        if (quantity <= 0) {
            await context_1.prisma.orderItem.delete({ where: { id: existingItem.id } });
        }
        else {
            await context_1.prisma.orderItem.update({
                where: { id: existingItem.id },
                data: { quantity, price: existingItem.price } // Recalculate if dynamic
            });
        }
        // Recalculate Total
        const updatedItems = await context_1.prisma.orderItem.findMany({ where: { orderId } });
        if (updatedItems.length === 0) {
            // Cart empty, delete order
            await context_1.prisma.order.delete({ where: { id: orderId } });
            res.status(200).json({ message: 'Order was empty and deleted.' });
            return;
        }
        const newTotal = updatedItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        const finalOrder = await context_1.prisma.order.update({
            where: { id: orderId },
            data: { totalAmount: newTotal },
            include: { items: true }
        });
        res.status(200).json({ message: 'Quantity updated', order: finalOrder });
    }
    catch (err) {
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
router.delete('/:id/item/:productId', async (req, res) => {
    try {
        const orderId = req.params.id;
        const productId = req.params.productId;
        const activeOrder = await context_1.prisma.order.findUnique({
            where: { id: orderId },
            include: { items: true }
        });
        if (!activeOrder) {
            res.status(404).json({ error: 'Order not found' });
            return;
        }
        const existingItem = activeOrder.items.find((item) => item.productId === productId);
        if (existingItem) {
            await context_1.prisma.orderItem.delete({ where: { id: existingItem.id } });
        }
        const updatedItems = await context_1.prisma.orderItem.findMany({ where: { orderId } });
        if (updatedItems.length === 0) {
            await context_1.prisma.order.delete({ where: { id: orderId } });
            res.status(200).json({ message: 'Item removed and empty order deleted.' });
            return;
        }
        const newTotal = updatedItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        const finalOrder = await context_1.prisma.order.update({
            where: { id: orderId },
            data: { totalAmount: newTotal },
            include: { items: true }
        });
        res.status(200).json({ message: 'Item removed', order: finalOrder });
    }
    catch (err) {
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
router.post('/:id/place', async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await context_1.prisma.order.findUnique({
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
        const updatedOrder = await context_1.prisma.order.update({
            where: { id: orderId },
            data: { status: 'placed' }
        });
        res.status(200).json({ message: 'Order successfully placed. Waiting for seller confirmation.', order: updatedOrder });
    }
    catch (err) {
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
router.post('/:id/confirm', async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await context_1.prisma.order.findUnique({
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
        const updatedOrder = await context_1.prisma.order.update({
            where: { id: orderId },
            data: { status: 'completed' }
        });
        res.status(200).json({ message: 'Order successfully confirmed by seller!', order: updatedOrder });
    }
    catch (err) {
        console.error('Error confirming order:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
