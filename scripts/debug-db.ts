import { prisma } from '../src/context';

async function main() {
    console.log('[DEBUG] Testing DB connection...');
    const users = await prisma.user.findMany({ select: { id: true, email: true } });
    console.log('[DEBUG] Found users:', users.length);

    console.log('[DEBUG] Specifically checking for user 49cdcdc3-0b6e-4eb0-9a80-8fec39dd892c');
    let user = await prisma.user.findUnique({ where: { id: '49cdcdc3-0b6e-4eb0-9a80-8fec39dd892c' } });

    if (!user) {
        console.log('[DEBUG] User missing, creating...');
        user = await prisma.user.create({
            data: {
                id: '49cdcdc3-0b6e-4eb0-9a80-8fec39dd892c',
                email: 'customer@email.ghostinspector.com',
                name: 'GI Customer',
                password: 'mock-auth-password'
            }
        });
    }

    console.log('[DEBUG] Finding seller...');
    const seller = await prisma.seller.findFirst();
    if (!seller) throw new Error('No seller found');

    const count = await prisma.order.count({
        where: { customerId: user.id }
    });

    if (count === 0) {
        console.log('[DEBUG] Creating order for user 49cdcdc3-0b6e-4eb0-9a80-8fec39dd892c...');
        const order = await prisma.order.create({
            data: {
                customerId: user.id,
                sellerId: seller.id,
                status: 'pending',
                totalAmount: 9.99
            }
        });
        console.log('[DEBUG] Order created:', order);
    } else {
        console.log('[DEBUG] Order already exists.');
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
