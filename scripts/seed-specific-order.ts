import { prisma } from '../src/context';

async function main() {
    console.log("Creating user if not exists...");
    const userId = '49cdcdc3-0b6e-4eb0-9a80-8fec39dd892c';
    let user = await prisma.user.findUnique({ where: { id: userId } });
    
    if (!user) {
        user = await prisma.user.create({
            data: {
                id: userId,
                email: 'customer@email.ghostinspector.com',
                name: 'Ghost Inspector Customer',
                password: 'mock-auth-password'
            }
        });
    }

    console.log("Finding a seller to assign order to...");
    const seller = await prisma.seller.findFirst();
    if (!seller) {
        throw new Error("No sellers found to create an order against!");
    }

    console.log("Finding a product for the order...");
    const product = await prisma.product.findFirst({ where: { sellerId: seller.id } });
    if (!product) {
        throw new Error("No products found to create an order against!");
    }

    console.log("Creating pending order...");
    await prisma.order.create({
        data: {
            customerId: user.id,
            sellerId: seller.id,
            status: 'pending',
            totalAmount: product.price * 2,
            items: {
                create: [
                    {
                        productId: product.id,
                        quantity: 2,
                        price: product.price
                    }
                ]
            }
        }
    });

    console.log("Done inserting order!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
