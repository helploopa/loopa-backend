import { Router, Request, Response } from 'express';
import multer from 'multer';
import { prisma } from '../context';
import { authenticateToken } from '../middleware/auth';
import { uploadFile } from '../services/storageService';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/users/me  — get current user profile
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/users/me:
 *   get:
 *     summary: Get the current user's profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 firstName:
 *                   type: string
 *                 lastName:
 *                   type: string
 *                 email:
 *                   type: string
 *                 profileImage:
 *                   type: string
 *                   nullable: true
 *                 emailVerified:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.userId as string;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        profileImage: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json(user);
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/users/me/profile  — update firstName, lastName, profileImage
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/users/me/profile:
 *   patch:
 *     summary: Update the current user's profile
 *     description: Update firstName, lastName, and/or profileImage. Send as multipart/form-data when uploading an image; otherwise JSON is accepted for text fields only.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               profileImage:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Profile updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.patch('/profile', authenticateToken, upload.single('profileImage'), async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.userId as string;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { firstName, lastName } = req.body;

  if (firstName !== undefined && (typeof firstName !== 'string' || firstName.trim().length === 0)) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'firstName must be a non-empty string' });
    return;
  }
  if (lastName !== undefined && (typeof lastName !== 'string' || lastName.trim().length === 0)) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'lastName must be a non-empty string' });
    return;
  }

  const updates: Record<string, any> = {};

  if (firstName !== undefined) {
    updates.firstName = firstName.trim();
  }
  if (lastName !== undefined) {
    updates.lastName = lastName.trim();
  }
  if (updates.firstName !== undefined || updates.lastName !== undefined) {
    const current = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
    const first = updates.firstName ?? current?.firstName ?? '';
    const last = updates.lastName ?? current?.lastName ?? '';
    updates.name = `${first} ${last}`.trim();
  }

  if (req.file) {
    const ext = req.file.originalname.split('.').pop() ?? 'jpg';
    const storageKey = `users/${userId}/profile/${Date.now()}.${ext}`;
    const result = await uploadFile(req.file.buffer, storageKey, req.file.mimetype);
    updates.profileImage = result.publicUrl;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'No updatable fields provided' });
    return;
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: updates,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        profileImage: true,
        emailVerified: true,
      },
    });

    res.status(200).json(user);
  } catch (err) {
    console.error('Error updating user profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
