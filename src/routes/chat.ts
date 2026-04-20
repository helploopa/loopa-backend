import { Router, Request, Response } from 'express';
import path from 'path';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../context';
import { authenticateToken } from '../middleware/auth';
import { sendPushNotification } from '../services/pushNotification';

const router = Router();

// ── Image upload (local disk, 5 MB cap) ─────────────────────────────────────
const storage = multer.diskStorage({
    destination: path.join(process.cwd(), 'uploads'),
    filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}${path.extname(file.originalname)}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed'));
        }
        cb(null, true);
    },
});

// ── Rate limiter: max 30 messages per minute per user ────────────────────────
const messageLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    // All chat routes are behind authenticateToken, so userId is always present
    keyGenerator: (req) => (req.user?.userId as string) ?? 'anonymous',
    message: { error: 'Too many messages. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ── Zod schemas ──────────────────────────────────────────────────────────────
const createChatSchema = z.object({
    participantId: z.string().uuid('Invalid participant ID'),
    orderId: z.string().uuid('Invalid order ID').optional(),
});

const sendMessageSchema = z.object({
    content: z.string().min(1).max(2000).optional(),
    type: z.enum(['text', 'image', 'sample_offer']).default('text'),
});

// ── Helper: assert caller is a chat participant ──────────────────────────────
async function getChatForParticipant(chatId: string, userId: string) {
    const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: {
            participant1: { select: { id: true, name: true } },
            participant2: { select: { id: true, name: true } },
            order: {
                select: {
                    id: true,
                    orderNumber: true,
                    items: {
                        take: 1,
                        include: { product: { select: { primaryImage: true, title: true } } },
                    },
                },
            },
        },
    });

    if (!chat) return null;
    if (chat.participant1Id !== userId && chat.participant2Id !== userId) return null;
    return chat;
}

// ════════════════════════════════════════════════════════════════════════════
// POST /api/chats  — create or retrieve existing chat
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/chats:
 *   post:
 *     summary: Create or retrieve a chat
 *     description: Opens a new chat between the caller and another user, optionally tied to an order. Returns existing chat if one already exists for the same pair + order.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - participantId
 *             properties:
 *               participantId:
 *                 type: string
 *               orderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Existing chat returned
 *       201:
 *         description: New chat created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const parsed = createChatSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }

    const { participantId, orderId } = parsed.data;

    if (participantId === userId) {
        res.status(400).json({ error: 'Cannot start a chat with yourself' });
        return;
    }

    // Canonical ordering so the unique constraint stays stable
    const [p1, p2] = [userId, participantId].sort();

    try {
        const existing = await prisma.chat.findFirst({
            where: {
                participant1Id: p1,
                participant2Id: p2,
                orderId: orderId ?? null,
            },
        });

        if (existing) {
            res.status(200).json(existing);
            return;
        }

        const chat = await prisma.chat.create({
            data: {
                participant1Id: p1,
                participant2Id: p2,
                orderId: orderId ?? null,
            },
        });

        res.status(201).json(chat);
    } catch (err) {
        console.error('Error creating chat:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/chats  — list all chats for the current user
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/chats:
 *   get:
 *     summary: List all chats for the current user
 *     description: Returns chats sorted by last activity, with last message preview, other participant info, and product thumbnail for order-linked chats.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of chat summaries
 *       401:
 *         description: Unauthorized
 */
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    try {
        const chats = await prisma.chat.findMany({
            where: {
                OR: [{ participant1Id: userId }, { participant2Id: userId }],
            },
            orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
            include: {
                participant1: { select: { id: true, name: true } },
                participant2: { select: { id: true, name: true } },
                order: {
                    select: {
                        id: true,
                        orderNumber: true,
                        items: {
                            take: 1,
                            include: { product: { select: { primaryImage: true, title: true } } },
                        },
                    },
                },
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { content: true, type: true, createdAt: true, senderId: true },
                },
            },
        });

        const result = chats.map((chat) => {
            const other =
                chat.participant1Id === userId ? chat.participant2 : chat.participant1;
            const unreadCount =
                chat.participant1Id === userId ? chat.unreadCount1 : chat.unreadCount2;
            const lastMessage = chat.messages[0] ?? null;

            return {
                id: chat.id,
                orderId: chat.orderId,
                orderNumber: chat.order?.orderNumber ?? null,
                productThumbnail: chat.order?.items[0]?.product.primaryImage ?? null,
                productTitle: chat.order?.items[0]?.product.title ?? null,
                otherParticipant: other,
                lastMessage,
                unreadCount,
                createdAt: chat.createdAt,
                lastMessageAt: chat.lastMessageAt,
            };
        });

        res.status(200).json(result);
    } catch (err) {
        console.error('Error listing chats:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/chats/:chatId  — chat details
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/chats/{chatId}:
 *   get:
 *     summary: Get chat details
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Chat details
 *       403:
 *         description: Not a participant
 *       404:
 *         description: Chat not found
 */
router.get('/:chatId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const chat = await getChatForParticipant(req.params.chatId as string, userId);
    if (!chat) { res.status(404).json({ error: 'Chat not found or access denied' }); return; }

    const other = chat.participant1Id === userId ? chat.participant2 : chat.participant1;
    const unreadCount =
        chat.participant1Id === userId ? chat.unreadCount1 : chat.unreadCount2;

    res.status(200).json({ ...chat, otherParticipant: other, unreadCount });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/chats/:chatId/messages  — paginated message history
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/chats/{chatId}/messages:
 *   get:
 *     summary: Get paginated messages for a chat
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Message ID to paginate from (exclusive)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 30
 *     responses:
 *       200:
 *         description: Paginated messages (newest first)
 *       403:
 *         description: Not a participant
 *       404:
 *         description: Chat not found
 */
router.get('/:chatId/messages', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const chat = await getChatForParticipant(req.params.chatId as string, userId);
    if (!chat) { res.status(404).json({ error: 'Chat not found or access denied' }); return; }

    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const cursor = req.query.cursor as string | undefined;

    try {
        const messages = await prisma.message.findMany({
            where: { chatId: chat.id },
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
            ...(cursor
                ? { cursor: { id: cursor }, skip: 1 }
                : {}),
            include: { sender: { select: { id: true, name: true } } },
        });

        const hasMore = messages.length > limit;
        const page = hasMore ? messages.slice(0, limit) : messages;
        const nextCursor = hasMore ? page[page.length - 1].id : null;

        res.status(200).json({ messages: page, nextCursor, hasMore });
    } catch (err) {
        console.error('Error fetching messages:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/chats/:chatId/messages  — send a message (text or image)
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/chats/{chatId}/messages:
 *   post:
 *     summary: Send a message in a chat
 *     description: Supports text messages and image uploads (multipart/form-data). Rate limited to 30 messages/minute.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [text, image, sample_offer]
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: string
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Message sent
 *       400:
 *         description: Validation error
 *       429:
 *         description: Rate limit exceeded
 */
router.post(
    '/:chatId/messages',
    authenticateToken,
    messageLimiter,
    upload.single('image'),
    async (req: Request, res: Response): Promise<void> => {
        const userId = req.user?.userId as string;
        if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

        const chat = await getChatForParticipant(req.params.chatId as string, userId);
        if (!chat) { res.status(404).json({ error: 'Chat not found or access denied' }); return; }

        const parsed = sendMessageSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.flatten() });
            return;
        }

        const { content, type } = parsed.data;
        const imageUrl = req.file
            ? `/uploads/${req.file.filename}`
            : undefined;

        if (!content && !imageUrl) {
            res.status(400).json({ error: 'Message must have content or an image' });
            return;
        }

        const messageType = req.file ? 'image' : type;

        const receiverId =
            chat.participant1Id === userId ? chat.participant2Id : chat.participant1Id;

        const unreadUpdate =
            chat.participant1Id === receiverId
                ? { unreadCount1: { increment: 1 } }
                : { unreadCount2: { increment: 1 } };

        try {
            const [message] = await prisma.$transaction([
                prisma.message.create({
                    data: {
                        chatId: chat.id,
                        senderId: userId,
                        content,
                        imageUrl,
                        type: messageType,
                        readBy: [userId],
                    },
                    include: { sender: { select: { id: true, name: true } } },
                }),
                prisma.chat.update({
                    where: { id: chat.id },
                    data: { lastMessageAt: new Date(), ...unreadUpdate },
                }),
            ]);

            // Fire-and-forget push notification
            const senderName = message.sender?.name ?? 'Someone';
            const preview = messageType === 'image' ? '📷 Sent a photo' : (content ?? '');
            sendPushNotification(receiverId, senderName, preview, {
                type: 'message',
                id: message.id,
                chatId: chat.id,
            }).catch(console.error);

            res.status(201).json(message);
        } catch (err) {
            console.error('Error sending message:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

// ════════════════════════════════════════════════════════════════════════════
// POST /api/chats/:chatId/mark-read  — mark all messages as read
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/chats/{chatId}/mark-read:
 *   post:
 *     summary: Mark all messages in a chat as read
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Messages marked as read
 *       404:
 *         description: Chat not found
 */
router.post('/:chatId/mark-read', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const chat = await getChatForParticipant(req.params.chatId as string, userId);
    if (!chat) { res.status(404).json({ error: 'Chat not found or access denied' }); return; }

    try {
        await prisma.message.updateMany({
            where: {
                chatId: chat.id,
                NOT: { readBy: { has: userId } },
            },
            data: { readBy: { push: userId } },
        });

        const unreadReset =
            chat.participant1Id === userId
                ? { unreadCount1: 0 }
                : { unreadCount2: 0 };

        await prisma.chat.update({ where: { id: chat.id }, data: unreadReset });

        res.status(200).json({ message: 'Messages marked as read' });
    } catch (err) {
        console.error('Error marking messages as read:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/users/me/push-token  — register Expo push token
// ════════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/users/me/push-token:
 *   patch:
 *     summary: Register or update Expo push token for the current user
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - expoPushToken
 *             properties:
 *               expoPushToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token saved
 *       400:
 *         description: Invalid token
 */
router.patch('/push-token', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId as string;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { expoPushToken } = req.body;
    if (!expoPushToken || typeof expoPushToken !== 'string') {
        res.status(400).json({ error: 'expoPushToken is required' });
        return;
    }

    try {
        await prisma.user.update({ where: { id: userId }, data: { expoPushToken } });
        res.status(200).json({ message: 'Push token saved' });
    } catch (err) {
        console.error('Error saving push token:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
