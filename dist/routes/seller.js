"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const context_1 = require("../context");
const router = (0, express_1.Router)();
/**
 * @swagger
 * /seller/{id}:
 *   get:
 *     summary: Get a seller by ID
 *     description: Retrieves the detailed profile of a specific seller. Includes sample rules and categories.
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
router.get('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const seller = await context_1.prisma.seller.findUnique({
            where: { id },
            include: {
                user: {
                    select: {
                        name: true,
                        email: true
                    }
                }
            }
        });
        const reviewsAggregation = await context_1.prisma.orderReview.aggregate({
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
        const payload = {
            ...seller,
            reviewsSummary: {
                average: reviewsAggregation._avg.overallRating || 0,
                count: reviewsAggregation._count.id
            }
        };
        res.status(200).json(payload);
    }
    catch (error) {
        console.error('Error fetching seller:', error);
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
router.get('/:id/products', async (req, res) => {
    try {
        const id = req.params.id;
        // Ensure seller exists first
        const seller = await context_1.prisma.seller.findUnique({
            where: { id },
        });
        if (!seller) {
            res.status(404).json({ error: 'Seller not found' });
            return;
        }
        const products = await context_1.prisma.product.findMany({
            where: { sellerId: id },
            orderBy: { createdAt: 'desc' } // Optional: order by newest first
        });
        res.status(200).json(products);
    }
    catch (error) {
        console.error('Error fetching seller products:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
