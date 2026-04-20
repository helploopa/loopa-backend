import { prisma } from '../src/context';

async function verifyPickups() {
    try {
        console.log("Fetching a sample seller...");
        const seller = await prisma.seller.findFirst({
             include: { user: true }
        });
        
        if (!seller || !seller.user) {
             console.log("No seller found.");
             return;
        }

        console.log(`Testing with Seller: ${seller.name}`);
        
        // Simulating the Maker Hub Pickups Logic:
        const isToday = true;
        const targetDateStr = new Date().toISOString().split('T')[0];
        
        const orders = await prisma.order.findMany({
            where: {
                sellerId: seller.id,
                status: { in: ['APPROVED', 'IN_PROGRESS', 'READY_FOR_PICKUP'] }
            },
            include: {
                customer: true,
                items: {
                    include: { product: true }
                }
            },
            orderBy: { createdAt: 'asc' }
        });

        console.log(`Found ${orders.length} orders matching status...`);

        const pickups = [];
        for (const order of orders) {
            const pickupDataInfo = order.pickupData as any;
            const timeSlot = pickupDataInfo?.timeSlot || "";
            
            // Substring match e.g. "Mar 22" 
            const dateObj = new Date(targetDateStr);
            const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const monthStr = months[dateObj.getMonth()];
            const dayStr = dateObj.getDate().toString();
            const dateSubstr = `${monthStr} ${dayStr}`;

            console.log(`Checking order ${order.orderNumber}. TimeSlot: "${timeSlot}" against Target Substring: "${dateSubstr}"`);

            if (!timeSlot.includes(dateSubstr)) {
                 console.log(">> Skipped because timeslot doesn't match.");
                 continue; // For testing, let's see if we skip it
            }

            console.log(">> Matched! Adding Pickup.");
            pickups.push({ pickup_id: order.id });
        }
        
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

verifyPickups();
