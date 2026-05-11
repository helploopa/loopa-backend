import cron from 'node-cron';
import { prisma } from '../context';

export async function runFreeSampleSweep() {
  console.log('[JOB] Starting Free Sample Eligibility Sweep...');
  let updatedCount = 0;

  try {
    // 1. Find all completed/closed orders that haven't been marked eligible yet,
    // and where free sample is not claimed.
    const eligibleCandidates = await prisma.order.findMany({
      where: {
        status: {
          in: ['completed', 'COMPLETED', 'CLOSED'],
        },
        freeSampleEligible: false,
        freeSampleClaimed: false,
      },
      include: {
        items: {
          select: { id: true },
        },
        reviews: {
          select: { orderItemId: true },
        },
      },
    });

    // 2. Evaluate each order
    for (const order of eligibleCandidates) {
      // If there are no items, skip
      if (!order.items || order.items.length === 0) continue;

      // Check if every item has at least one associated review
      const reviewedItemIds = new Set(order.reviews.map((r) => r.orderItemId));
      const allItemsReviewed = order.items.every((item) => reviewedItemIds.has(item.id));

      if (allItemsReviewed) {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            freeSampleEligible: true,
            freeSampleExpiry: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
          },
        });
        updatedCount++;
      }
    }

    console.log(`[JOB] Sweep complete. Marked ${updatedCount} orders as eligible for a free sample.`);
    return { success: true, updatedCount };
  } catch (error) {
    console.error('[JOB] Error during Free Sample Eligibility Sweep:', error);
    throw error;
  }
}

export function initFreeSampleSweepJob() {
  // Run every day at midnight server time
  cron.schedule('0 0 * * *', async () => {
    try {
      await runFreeSampleSweep();
    } catch (e) {
      // Error already logged by runFreeSampleSweep
    }
  });
}
