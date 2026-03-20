import { prisma } from '../src/context';
async function main() {
    console.log("Seeding test customer...");
    await prisma.user.upsert({
        where: { email: 'testcustomer@example.com' },
        update: {},
        create: {
            email: 'testcustomer@example.com',
            password: 'mock-auth-password',
            name: 'Test Customer'
        }
    });

    console.log("Seeding test seller...");
    const sellerUser = await prisma.user.upsert({
        where: { email: 'maker@example.com' },
        update: {},
        create: {
            email: 'maker@example.com',
            password: 'mock-auth-password',
            name: 'Test Maker'
        }
    });

    const seller = await prisma.seller.upsert({
        where: { userId: sellerUser.id },
        update: {},
        create: {
            userId: sellerUser.id,
            name: 'Test Maker Shop',
            description: 'A test shop',
            longitude: 0,
            latitude: 0
        }
    });

    console.log("Seeding test product...");
    await prisma.product.create({
        data: {
            sellerId: seller.id,
            title: 'Test Product',
            description: 'A test product',
            price: 10.0,
            quantityAvailable: 100,
            quantityLeft: 100
        }
    });
}
main().catch(console.error).finally(()=>prisma.\$disconnect());
