// expo-server-sdk is an ESM-only package; use dynamic import in this CJS module.
import { prisma } from '../context';

export type PushNotificationData =
    | { type: 'order'; id: string; status?: string }
    | { type: 'message'; id: string; chatId: string };

/**
 * Send a push notification to a single user by their userId.
 * Silently no-ops if the user has no registered Expo push token.
 */
export async function sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data: PushNotificationData
): Promise<void> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { expoPushToken: true },
    });

    if (!user?.expoPushToken) return;

    const token = user.expoPushToken;

    // Dynamic import for ESM-only package
    const { default: Expo } = await import('expo-server-sdk');
    const expo = new Expo();

    if (!Expo.isExpoPushToken(token)) {
        console.warn(`Invalid Expo push token for user ${userId}: ${token}`);
        return;
    }

    const message = {
        to: token,
        sound: 'default' as const,
        title,
        body,
        data: data as Record<string, unknown>,
    };

    try {
        const chunks = expo.chunkPushNotifications([message]);

        for (const chunk of chunks) {
            const tickets = await expo.sendPushNotificationsAsync(chunk);
            for (const ticket of tickets) {
                if (ticket.status === 'error') {
                    console.error(`Push notification error for user ${userId}:`, ticket.message);
                    // Clear invalid token from DB
                    if ((ticket as any).details?.error === 'DeviceNotRegistered') {
                        await prisma.user.update({
                            where: { id: userId },
                            data: { expoPushToken: null },
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error(`Failed to send push notification to user ${userId}:`, err);
    }
}

/**
 * Broadcast order status change push to both buyer and seller.
 */
export async function notifyOrderStatusChange(
    orderId: string,
    buyerId: string,
    sellerId: string,
    sellerUserId: string,
    newStatus: string
): Promise<void> {
    const statusLabels: Record<string, { title: string; body: string }> = {
        APPROVED: { title: 'Order Confirmed!', body: 'Your order has been confirmed by the maker.' },
        CANCELLED: { title: 'Order Cancelled', body: 'Your order has been cancelled.' },
        CLOSED: { title: 'Order Completed', body: 'Your order is complete. Thank you!' },
        CHANGES_REQUESTED: {
            title: 'Changes Requested',
            body: 'The maker has requested changes to your order.',
        },
        READY_FOR_PICKUP: {
            title: 'Ready for Pickup!',
            body: 'Your order is ready for pickup. Head over when you can!',
        },
    };

    const notification = statusLabels[newStatus] ?? {
        title: 'Order Update',
        body: `Your order status changed to ${newStatus}.`,
    };

    const data: PushNotificationData = { type: 'order', id: orderId, status: newStatus };

    await Promise.all([
        sendPushNotification(buyerId, notification.title, notification.body, data),
        sendPushNotification(sellerUserId, 'Order Update', `Order status changed to ${newStatus}.`, data),
    ]);
}
