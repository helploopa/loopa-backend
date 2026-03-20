import { Router, Request, Response } from 'express';

const router = Router();

/**
 * @swagger
 * /ping:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns a simple pong message to verify the API is running.
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: pong
 */
router.get('/', (req: Request, res: Response) => {
    res.status(200).json({ message: 'pong' });
});

export default router;
