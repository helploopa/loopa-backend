import { prisma } from '../src/context';

async function seed() {
    const customer = await prisma.user.findUnique({ where: { email: 'testcustomer@example.com' } });
    const seller = await prisma.seller.findFirst();

    if (!customer || !seller) {
        throw new Error('Customer or Seller not found');
    }

    // See if product exists
    let product = await prisma.product.findFirst({ where: { sellerId: seller.id } });
    if (!product) {
        product = await prisma.product.create({
            data: {
                sellerId: seller.id,
                title: 'Dummy Product',
                description: 'A test product',
                price: 10.0,
                quantityAvailable: 100,
                quantityLeft: 100
            }
        });
    }

    // Create a pending order for the customer
    await prisma.order.create({
        data: {
            customerId: customer.id,
            sellerId: seller.id,
            status: 'pending',
            totalAmount: 20.0,
            items: {
                create: [
                    {
                        productId: product.id,
                        quantity: 2,
                        price: 10.0
                    }
                ]
            }
        }
    });

    console.log('Created dummy pending order');
}

seed()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
