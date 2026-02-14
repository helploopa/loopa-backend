
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    // Clean up existing data
    await prisma.story.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.seller.deleteMany({});
    await prisma.user.deleteMany({});

    const user = await prisma.user.create({
        data: {
            email: 'seller@loopa.app',
            name: 'The Candle Nook Owner',
            password: 'hashedpassword', // In real app, hash this
        },
    });

    const seller = await prisma.seller.create({
        data: {
            userId: user.id,
            name: 'The Candle Nook',
            description: 'Handcrafted candles for your home.',
            latitude: 40.94, // Near sample location
            longitude: -123.63,
            pickupDays: 'Mon-Fri',
            pickupStartTime: '17:00',
            pickupEndTime: '19:00',
        },
    });

    const product = await prisma.product.create({
        data: {
            sellerId: seller.id,
            title: 'Lavender & Sage Candle',
            description: 'Calming scent.',
            price: 15.00,
            currency: 'USD',
            quantityAvailable: 12,
            quantityLeft: 12,
            images: ['https://cdn.loopa.app/products/candle-1.jpg', 'https://cdn.loopa.app/products/candle-2.jpg'],
            primaryImage: 'https://cdn.loopa.app/products/candle-main.jpg',
            imageUrl: 'https://cdn.loopa.app/products/candle-main.jpg',
            category: 'body',
            tags: ['soy', 'handmade', 'sustainable', 'aromatherapy'],
            pickupWindows: [
                {
                    days: "Mon-Fri",
                    startTime: "17:00",
                    endTime: "19:00",
                    formatted: "Mon-Fri 5:00 PM - 7:00 PM"
                }
            ],
            pickupLocation: {
                address: "88 Oak Ave, Willow Creek",
                latitude: 40.9382,
                longitude: -123.6321,
                distanceMiles: 1.2,
                isExact: false
            },
            badges: ['Handmade', 'Organic'],
        },
    });

    const categoriesData = [
        { label: 'All', icon: 'home', isActive: true, count: 0 },
        { label: 'Bakery', icon: 'croissant', count: 14 },
        { label: 'Sweets', icon: 'cookie', count: 9 },
        { label: 'Body', icon: 'soap', count: 11 }
    ];

    for (const cat of categoriesData) {
        await prisma.category.create({
            data: cat
        });
    }

    // Create a sample offering from a different seller
    const sampleSeller = await prisma.seller.create({
        data: {
            userId: user.id, // Reusing same user for simplicity
            name: 'Sarah\'s Kitchen',
            description: 'Small-batch artisan jams and preserves.',
            latitude: 40.9401,
            longitude: -123.6305,
            pickupDays: 'Sat-Sun',
            pickupStartTime: '10:00',
            pickupEndTime: '16:00',
        },
    });

    const sampleProduct = await prisma.product.create({
        data: {
            sellerId: sampleSeller.id,
            title: 'Spiced Peach & Honey Jam',
            description: 'Testing a new small-batch recipe using local orchard peaches.',
            price: 0, // Free sample
            currency: 'USD',
            quantityAvailable: 5,
            quantityLeft: 5,
            images: ['https://cdn.loopa.app/products/peach-jam.jpg'],
            primaryImage: 'https://cdn.loopa.app/products/peach-jam.jpg',
            category: 'food',
            tags: ['sample', 'jam', 'local'],
            badges: ['Free Sample'],
        },
    });

    const sample = await prisma.sample.create({
        data: {
            sellerId: sampleSeller.id,
            productId: sampleProduct.id,
            status: 'available',
            pickupWindows: [
                {
                    id: "win_1",
                    day: "Tomorrow",
                    startTime: "15:00",
                    endTime: "17:00",
                    formatted: "Tomorrow 3:00–5:00 PM",
                    available: true
                },
                {
                    id: "win_2",
                    day: "Sat",
                    startTime: "10:00",
                    endTime: "12:00",
                    formatted: "Sat 10:00 AM–12:00 PM",
                    available: true
                }
            ],
            expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 hours from now
        },
    });

    console.log({ user, seller, product, categoriesCount: categoriesData.length, sampleSeller, sampleProduct, sample });
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
