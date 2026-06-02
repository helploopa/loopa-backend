import * as admin from 'firebase-admin';
import { prisma } from '../context';
import '../firebase'; // ensure Firebase Admin is initialized

export type PushNotificationData =
  | { type: 'new_message'; conversationId: string; participantName?: string; participantAvatar?: string; orderId?: string; orderNumber?: string }
  | { type: 'order_update'; orderId: string; status?: string };

/**
 * Send a push notification to a single user by their userId.
 * Silently no-ops if the user has no registered FCM token.
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data: PushNotificationData,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fcmToken: true },
  });

  if (!user?.fcmToken) return;

  // FCM requires all data values to be strings.
  const stringData: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      stringData[key] = String(value);
    }
  }

  try {
    await admin.messaging().send({
      token: user.fcmToken,
      notification: { title, body },
      data: stringData,
      android: {
        priority: 'high',
        notification: { sound: 'default' },
      },
      apns: {
        payload: { aps: { sound: 'default' } },
      },
    });
  } catch (err: any) {
    console.error(`Failed to send push notification to user ${userId}:`, err?.message ?? err);
    // Clear stale token so we don't attempt it again.
    if (
      err?.code === 'messaging/registration-token-not-registered' ||
      err?.code === 'messaging/invalid-registration-token'
    ) {
      await prisma.user.update({ where: { id: userId }, data: { fcmToken: null } });
    }
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
  newStatus: string,
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

  const data: PushNotificationData = { type: 'order_update', orderId, status: newStatus };

  await Promise.all([
    sendPushNotification(buyerId, notification.title, notification.body, data),
    sendPushNotification(sellerUserId, 'Order Update', `Order status changed to ${newStatus}.`, data),
  ]);
}
