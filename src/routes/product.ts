import { Router, Request, Response } from 'express';
import { prisma } from '../context';

const router = Router();

/**
 * @swagger
 * /product/{id}:
 *   get:
 *     summary: Get a product by ID
 *     description: Retrieves the detailed profile of a specific product. Includes basic seller information.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID of the product
 *     responses:
 *       200:
 *         description: Product profile object
 *       404:
 *         description: Product not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
        const id = req.params.id as string;

        const product = await prisma.product.findUnique({
            where: { id },
            include: {
                seller: {
                    select: {
                        id: true,
                        name: true,
                        avatarUrl: true,
                    }
                }
            }
        });

        if (!product) {
            res.status(404).json({ error: 'Product not found' });
            return;
        }

        res.status(200).json(product);
    } catch (error) {
        console.error('Error fetching product details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
