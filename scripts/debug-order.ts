import { prisma } from '../src/context';

async function main() {
    console.log("--- Checking Order ---");
    const orderId = '5f08a84c-1d20-4647-bde6-8732885307d7';
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (order) {
        console.log(JSON.stringify(order, null, 2));
    } else {
        console.log(`Order ${orderId} not found.`);
    }

    console.log("\n--- Checking Seller ---");
    const sellerUserId = '1234567890-098-0987-0983-mkiujikolo98';
    const seller = await prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (seller) {
        console.log(JSON.stringify(seller, null, 2));
    } else {
        console.log(`Seller with user ID ${sellerUserId} not found.`);
    }

    if (order && seller) {
        console.log("\n--- Relationship Check ---");
        if (order.sellerId !== seller.id) {
            console.log(`Mismatch! Order sellerId is ${order.sellerId}, but target seller id is ${seller.id}`);
        } else {
            console.log("Seller ownership matches!");
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
