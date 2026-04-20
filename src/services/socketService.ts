import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { prisma } from '../context';
import { sendPushNotification } from './pushNotification';

const JWT_SECRET = process.env.JWT_SECRET || 'development-mock-secret';

// Tracks which chatIds each socket is actively viewing: socketId -> Set<chatId>
const activeChats = new Map<string, Set<string>>();

// Tracks userId -> socketId for presence checks
const userSockets = new Map<string, string>();

export interface AuthenticatedSocket extends Socket {
    userId: string;
}

export function initSocketIO(httpServer: HttpServer): SocketIOServer {
    const io = new SocketIOServer(httpServer, {
        cors: { origin: '*', methods: ['GET', 'POST'] },
    });

    // JWT auth handshake
    io.use((socket: Socket, next) => {
        const token = socket.handshake.auth?.token as string | undefined;
        if (!token) return next(new Error('Unauthorized: no token'));

        try {
            const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
            (socket as AuthenticatedSocket).userId = decoded.userId;
            next();
        } catch {
            next(new Error('Unauthorized: invalid token'));
        }
    });

    io.on('connection', (socket: Socket) => {
        const authedSocket = socket as AuthenticatedSocket;
        const { userId } = authedSocket;

        userSockets.set(userId, socket.id);
        activeChats.set(socket.id, new Set());

        // ── join-chat ────────────────────────────────────────────────────────
        socket.on('join-chat', async ({ chatId }: { chatId: string }) => {
            const chat = await prisma.chat.findUnique({ where: { id: chatId } });
            if (!chat) return;

            const isParticipant =
                chat.participant1Id === userId || chat.participant2Id === userId;
            if (!isParticipant) return;

            socket.join(`chat:${chatId}`);
            activeChats.get(socket.id)?.add(chatId);
        });

        // ── leave-chat ───────────────────────────────────────────────────────
        socket.on('leave-chat', ({ chatId }: { chatId: string }) => {
            socket.leave(`chat:${chatId}`);
            activeChats.get(socket.id)?.delete(chatId);
        });

        // ── send-message ─────────────────────────────────────────────────────
        socket.on(
            'send-message',
            async ({
                chatId,
                content,
                imageUrl,
                type = 'text',
            }: {
                chatId: string;
                content?: string;
                imageUrl?: string;
                type?: string;
            }) => {
                if (!content && !imageUrl) return;

                const chat = await prisma.chat.findUnique({ where: { id: chatId } });
                if (!chat) return;

                const isParticipant =
                    chat.participant1Id === userId || chat.participant2Id === userId;
                if (!isParticipant) return;

                const receiverId =
                    chat.participant1Id === userId ? chat.participant2Id : chat.participant1Id;

                const isReceiverActive = isUserInChat(receiverId, chatId);

                // Determine which unread counter to bump (the receiver's)
                const unreadUpdate =
                    chat.participant1Id === receiverId
                        ? { unreadCount1: { increment: 1 } }
                        : { unreadCount2: { increment: 1 } };

                const [message] = await prisma.$transaction([
                    prisma.message.create({
                        data: {
                            chatId,
                            senderId: userId,
                            content,
                            imageUrl,
                            type,
                            readBy: [userId],
                        },
                        include: { sender: { select: { id: true, name: true, expoPushToken: true } } },
                    }),
                    prisma.chat.update({
                        where: { id: chatId },
                        data: { lastMessageAt: new Date(), ...(!isReceiverActive ? unreadUpdate : {}) },
                    }),
                ]);

                // Broadcast to everyone in the room
                io.to(`chat:${chatId}`).emit('new-message', message);

                // Push notification only when receiver is not actively in the chat
                if (!isReceiverActive) {
                    const senderName = message.sender?.name ?? 'Someone';
                    const preview =
                        type === 'image' ? '📷 Sent a photo' : (content ?? '');
                    await sendPushNotification(
                        receiverId,
                        senderName,
                        preview,
                        { type: 'message', id: message.id, chatId }
                    );
                }
            }
        );

        // ── typing ───────────────────────────────────────────────────────────
        socket.on('typing', ({ chatId, isTyping }: { chatId: string; isTyping: boolean }) => {
            socket.to(`chat:${chatId}`).emit('typing', { userId, chatId, isTyping });
        });

        // ── message-read ─────────────────────────────────────────────────────
        socket.on('message-read', async ({ chatId }: { chatId: string }) => {
            const chat = await prisma.chat.findUnique({ where: { id: chatId } });
            if (!chat) return;

            const isParticipant =
                chat.participant1Id === userId || chat.participant2Id === userId;
            if (!isParticipant) return;

            // Mark all unread messages as read by this user
            await prisma.message.updateMany({
                where: {
                    chatId,
                    NOT: { readBy: { has: userId } },
                },
                data: { readBy: { push: userId } },
            });

            // Reset this user's unread counter
            const unreadReset =
                chat.participant1Id === userId
                    ? { unreadCount1: 0 }
                    : { unreadCount2: 0 };

            await prisma.chat.update({ where: { id: chatId }, data: unreadReset });

            // Notify the other participant that messages were read
            socket.to(`chat:${chatId}`).emit('messages-read', { chatId, readBy: userId });
        });

        // ── disconnect ───────────────────────────────────────────────────────
        socket.on('disconnect', () => {
            activeChats.delete(socket.id);
            userSockets.delete(userId);
        });
    });

    return io;
}

/** Returns true if the given userId currently has an active socket in that chatId room. */
function isUserInChat(userId: string, chatId: string): boolean {
    const socketId = userSockets.get(userId);
    if (!socketId) return false;
    return activeChats.get(socketId)?.has(chatId) ?? false;
}
