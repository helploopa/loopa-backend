import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../context';
import * as jwt from 'jsonwebtoken';
import { sendVerificationEmail } from '../services/emailService';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'development-mock-secret';

// ════════════════════════════════════════════════════════════════════════════
// POST /auth/register — customer sign up
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new customer account
 *     description: Creates a customer account and sends a verification email. The account can log in immediately but email must be verified for full access.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - email
 *               - password
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: Sarah
 *               lastName:
 *                 type: string
 *                 example: Green
 *               email:
 *                 type: string
 *                 format: email
 *                 example: sarah@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: secret123
 *     responses:
 *       201:
 *         description: Account created — verification email sent
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already registered
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
    try {
        const { firstName, lastName, email, password } = req.body;

        // Validation
        if (!firstName || typeof firstName !== 'string' || firstName.trim().length === 0) {
            res.status(400).json({ error: 'VALIDATION_ERROR', message: 'firstName is required' });
            return;
        }
        if (!lastName || typeof lastName !== 'string' || lastName.trim().length === 0) {
            res.status(400).json({ error: 'VALIDATION_ERROR', message: 'lastName is required' });
            return;
        }
        if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            res.status(400).json({ error: 'VALIDATION_ERROR', message: 'A valid email address is required' });
            return;
        }
        if (!password || typeof password !== 'string' || password.length < 8) {
            res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters' });
            return;
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Check for existing account
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
            res.status(409).json({ error: 'EMAIL_TAKEN', message: 'An account with this email already exists' });
            return;
        }

        const skipVerification = process.env.SKIP_EMAIL_VERIFICATION === 'true';

        // Generate verification token (expires in 24 hours) — skipped in dev
        const emailVerificationToken = skipVerification ? null : crypto.randomBytes(32).toString('hex');
        const emailVerificationTokenExpiry = skipVerification ? null : new Date(Date.now() + 24 * 60 * 60 * 1000);

        const user = await prisma.user.create({
            data: {
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                name: `${firstName.trim()} ${lastName.trim()}`,
                email: normalizedEmail,
                password,
                emailVerified: skipVerification,
                emailVerificationToken,
                emailVerificationTokenExpiry,
            },
        });

        if (!skipVerification) {
            sendVerificationEmail(user.email, user.firstName!, emailVerificationToken!).catch((err) =>
                console.error('Failed to send verification email:', err)
            );
        }

        res.status(201).json({
            message: skipVerification
                ? 'Account created successfully.'
                : 'Account created successfully. Please check your email to verify your account.',
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                emailVerified: user.emailVerified,
            },
        });
    } catch (error) {
        console.error('Error in register:', error);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /auth/verify-email?token=<token> — verify email address
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /auth/verify-email:
 *   get:
 *     summary: Verify email address via token link
 *     description: Called when the user clicks the verification link in their email. Marks the account as verified.
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Verification token from the email link
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Token missing, invalid, or expired
 *       410:
 *         description: Token already used (email already verified)
 */
router.get('/verify-email', async (req: Request, res: Response): Promise<void> => {
    try {
        const token = req.query.token as string | undefined;

        if (!token) {
            res.status(400).json({ error: 'INVALID_TOKEN', message: 'Verification token is required' });
            return;
        }

        const user = await prisma.user.findUnique({
            where: { emailVerificationToken: token },
        });

        if (!user) {
            res.status(400).json({ error: 'INVALID_TOKEN', message: 'Invalid or expired verification link' });
            return;
        }

        if (user.emailVerified) {
            res.status(410).json({ error: 'ALREADY_VERIFIED', message: 'This email address has already been verified' });
            return;
        }

        if (user.emailVerificationTokenExpiry && user.emailVerificationTokenExpiry < new Date()) {
            res.status(400).json({ error: 'TOKEN_EXPIRED', message: 'Verification link has expired. Please request a new one.' });
            return;
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                emailVerified: true,
                emailVerificationToken: null,
                emailVerificationTokenExpiry: null,
            },
        });

        res.status(200).json({
            message: 'Email verified successfully! You can now log in.',
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                emailVerified: true,
            },
        });
    } catch (error) {
        console.error('Error in verify-email:', error);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /auth/resend-verification — resend verification email
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /auth/resend-verification:
 *   post:
 *     summary: Resend email verification link
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Verification email resent
 *       400:
 *         description: Already verified or user not found
 */
router.post('/resend-verification', async (req: Request, res: Response): Promise<void> => {
    try {
        const { email } = req.body;

        if (!email || typeof email !== 'string') {
            res.status(400).json({ error: 'VALIDATION_ERROR', message: 'email is required' });
            return;
        }

        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

        // Return 200 even if user not found to prevent email enumeration
        if (!user || user.emailVerified) {
            res.status(200).json({ message: 'If that address is registered and unverified, a new link has been sent.' });
            return;
        }

        const emailVerificationToken = crypto.randomBytes(32).toString('hex');
        const emailVerificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await prisma.user.update({
            where: { id: user.id },
            data: { emailVerificationToken, emailVerificationTokenExpiry },
        });

        sendVerificationEmail(user.email, user.firstName ?? 'there', emailVerificationToken).catch((err) =>
            console.error('Failed to resend verification email:', err)
        );

        res.status(200).json({ message: 'If that address is registered and unverified, a new link has been sent.' });
    } catch (error) {
        console.error('Error in resend-verification:', error);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /auth/login
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Log in to an existing account
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
 *         description: Successful login with JWT token
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Email not verified
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password } = req.body;

        if (!email || typeof email !== 'string') {
            res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Valid email is required' });
            return;
        }
        if (!password || typeof password !== 'string') {
            res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Password is required' });
            return;
        }

        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase().trim() },
            include: { seller: true },
        });

        if (!user || user.password !== password) {
            res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
            return;
        }

        const skipVerification = process.env.SKIP_EMAIL_VERIFICATION === 'true';
        if (!skipVerification && !user.emailVerified) {
            res.status(403).json({
                error: 'EMAIL_NOT_VERIFIED',
                message: 'Please verify your email address before logging in. Check your inbox for the verification link.',
            });
            return;
        }

        const role = user.seller ? 'Seller' : 'Customer';
        const payload = {
            userId: user.id,
            email: user.email,
            role,
            ...(user.seller ? { sellerId: user.seller.id } : {}),
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

        res.status(200).json({
            token,
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role,
                ...(user.seller ? { sellerId: user.seller.id } : {}),
            },
            redirect: role === 'Customer' ? '/discover' : '/dashboard',
        });
    } catch (error) {
        console.error('Error in login:', error);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
});

export default router;
