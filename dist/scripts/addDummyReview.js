"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
require("dotenv/config");
const connectionString = `${process.env.DATABASE_URL}`;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    const sellerId = '59139b0b-5407-40e0-a685-887ae0235ea4';
    console.log(`Finding seller ${sellerId}...`);
    const seller = await prisma.seller.findUnique({
        where: { id: sellerId },
        include: { products: true }
    });
    if (!seller) {
        console.error('Seller not found! Please check the ID.');
        return;
    }
    if (seller.products.length === 0) {
        console.log('Seller has no products. Creating a dummy product...');
        const product = await prisma.product.create({
            data: {
                sellerId: seller.id,
                title: 'Dummy Artisan Candle',
                description: 'A beautifully crafted dummy candle.',
                price: 25.0,
                category: 'Home & Decor'
            }
        });
        seller.products.push(product);
    }
    const productId = seller.products[0].id;
    console.log('Finding or creating a dummy customer...');
    let customer = await prisma.user.findFirst({
        where: { email: 'dummy.customer@example.com' }
    });
    if (!customer) {
        customer = await prisma.user.create({
            data: {
                email: 'dummy.customer@example.com',
                name: 'Jane Doe',
                password: 'password123'
            }
        });
    }
    console.log('Creating a dummy order...');
    const order = await prisma.order.create({
        data: {
            orderNumber: `ORD-${Math.floor(Math.random() * 100000)}`,
            totalAmount: 25.0,
            customerId: customer.id,
            sellerId: sellerId,
            status: 'completed'
        }
    });
    console.log('Creating a dummy order item...');
    const orderItem = await prisma.orderItem.create({
        data: {
            orderId: order.id,
            productId: productId,
            quantity: 1,
            price: 25.0
        }
    });
    console.log('Creating a dummy order review...');
    const review = await prisma.orderReview.create({
        data: {
            orderId: order.id,
            customerId: customer.id,
            orderItemId: orderItem.id,
            comments: 'Absolutely loved this product! The quality is amazing and it smells fantastic.',
            overallRating: 5
        }
    });
    console.log('Successfully created all dummy data! 🎉');
    console.log('--- Review Details ---');
    console.log('Review ID:', review.id);
    console.log('Comment:', review.comments);
    console.log('Rating:', review.overallRating);
}
main()
    .catch((e) => {
    console.error('Error executing script:', e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
});
