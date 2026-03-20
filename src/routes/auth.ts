import { Router, Request, Response } from 'express';
import { prisma } from '../context';
import * as jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'development-mock-secret';

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Mock login for development
 *     description: Creates a mock JWT session for a Customer or Seller based on email.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful login with token
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Internal server error
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password } = req.body;

        if (!email || typeof email !== 'string') {
            res.status(400).json({ error: 'Valid email is required' });
            return;
        }

        if (!password || typeof password !== 'string') {
            res.status(400).json({ error: 'Valid password is required' });
            return;
        }

        // Find user
        const user = await prisma.user.findUnique({
            where: { email },
            include: {
                seller: true // Include seller to get sellerId if it exists
            }
        });

        if (!user || user.password !== password) {
            res.status(401).json({ error: 'Invalid email or password' });
            return;
        }

        const role = user.seller ? 'Seller' : 'Customer';

        // Determine redirect path
        const redirect = role === 'Customer' ? '/discover' : '/dashboard';

        // Generate JWT payload
        const payload = {
            userId: user.id,
            email: user.email,
            role,
            ...(user.seller ? { sellerId: user.seller.id } : {})
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

        res.status(200).json({
            message: 'Mock login successful',
            token,
            redirect,
            user: payload
        });
    } catch (error) {
        console.error('Error in mock login:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
