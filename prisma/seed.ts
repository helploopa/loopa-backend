
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    // Clean up existing data (child tables first to avoid FK constraints)
    await prisma.orderReview.deleteMany({});
    await prisma.sample.deleteMany({});
    await prisma.story.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.order.deleteMany({});
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

    const products = await prisma.product.createMany({
        data: [
            {
                sellerId: seller.id,
                title: 'Backyard Apricot Jam',
                description: 'Sweet, tangy, and sunshine-filled jam made from the apricots in my garden. No preservatives.',
                price: 8.00,
                currency: 'USD',
                quantityAvailable: 5,
                quantityLeft: 5,
                images: ['https://images.unsplash.com/photo-1590779033100-9f60705a2f3b?auto=format&fit=crop&q=80&w=600'],
                primaryImage: 'https://images.unsplash.com/photo-1590779033100-9f60705a2f3b?auto=format&fit=crop&q=80&w=600',
                imageUrl: 'https://images.unsplash.com/photo-1590779033100-9f60705a2f3b?auto=format&fit=crop&q=80&w=600',
                category: 'sweets',
                tags: ['jam', 'apricot', 'homemade'],
                pickupWindows: [
                    {
                        days: "Sat",
                        startTime: "14:00",
                        endTime: "16:00",
                        formatted: "Sat 2:00 PM - 4:00 PM"
                    }
                ]
            },
            {
                sellerId: seller.id,
                title: 'Baker\'s Surprise Bundle',
                description: 'A mix of today\'s fresh bakes! Might include cookies, muffins...',
                price: 12.00,
                currency: 'USD',
                quantityAvailable: 3,
                quantityLeft: 3,
                images: ['https://images.unsplash.com/photo-1550617931-e17a7b70dce2?auto=format&fit=crop&q=80&w=600'], // Croissants/bread
                primaryImage: 'https://images.unsplash.com/photo-1550617931-e17a7b70dce2?auto=format&fit=crop&q=80&w=600',
                imageUrl: 'https://images.unsplash.com/photo-1550617931-e17a7b70dce2?auto=format&fit=crop&q=80&w=600',
                category: 'bakery',
                tags: ['bundle', 'surprise', 'bakery'],
            },
            {
                sellerId: seller.id,
                title: 'Sourdough Country Loaf',
                description: 'Classic crusty exterior with a soft, airy interior. 24-hour...',
                price: 9.00,
                currency: 'USD',
                quantityAvailable: 0,
                quantityLeft: 0, // SOLD OUT
                images: ['https://images.unsplash.com/photo-1585478259715-876a6a81f08e?auto=format&fit=crop&q=80&w=600'], // Sourdough
                primaryImage: 'https://images.unsplash.com/photo-1585478259715-876a6a81f08e?auto=format&fit=crop&q=80&w=600',
                imageUrl: 'https://images.unsplash.com/photo-1585478259715-876a6a81f08e?auto=format&fit=crop&q=80&w=600',
                category: 'bakery',
                tags: ['sourdough', 'bread', 'artisan'],
            },
            {
                sellerId: seller.id,
                title: 'Strawberry Fields Preserves',
                description: 'Freshly picked local strawberries simmered to...',
                price: 7.50,
                currency: 'USD',
                quantityAvailable: 8,
                quantityLeft: 8,
                images: ['https://images.unsplash.com/photo-1497534446932-c925b458314e?auto=format&fit=crop&q=80&w=600'], // Strawberries/jam
                primaryImage: 'https://images.unsplash.com/photo-1497534446932-c925b458314e?auto=format&fit=crop&q=80&w=600',
                imageUrl: 'https://images.unsplash.com/photo-1497534446932-c925b458314e?auto=format&fit=crop&q=80&w=600',
                category: 'sweets',
                tags: ['jam', 'strawberry', 'preserves'],
            }
        ]
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

    const sampleUser = await prisma.user.create({
        data: {
            email: 'sample_seller@loopa.app',
            name: 'Sarah Kitchen Owner',
            password: 'hashedpassword',
        },
    });

    // Create a sample offering from a different seller
    const sampleSeller = await prisma.seller.create({
        data: {
            userId: sampleUser.id, // Using new user to avoid unique constraint violation on userId
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

    const curryUser = await prisma.user.create({
        data: {
            email: 'curry_cubes@loopa.app',
            name: 'The Curry Cubes Owner',
            password: 'hashedpassword',
        },
    });

    const currySeller = await prisma.seller.create({
        data: {
            id: '1234567890-098-0987-0983-mkiujikolo98', // Explicitly setting the requested ID
            userId: curryUser.id,
            name: 'The Curry cubes',
            description: 'Authentic and delicious curry cubes.',
            latitude: 40.9400,
            longitude: -123.6300,
            pickupDays: 'Mon-Sun',
            pickupStartTime: '10:00',
            pickupEndTime: '20:00',
        },
    });

    const curryProduct = await prisma.product.create({
        data: {
            sellerId: currySeller.id,
            title: 'Dynamite Cube',
            description: 'A tangy and spicy tomato tamarind chutney made with pearl onions, garlic, green chilies, and traditional spices. Balanced with a touch of jaggery for a rich homemade sweet-sour flavor, perfect with rice, dosa, idli, or snacks.',
            price: 4,
            currency: 'USD',
            quantityAvailable: 5,
            quantityLeft: 8,
            primaryImage: 'https://images.unsplash.com/photo-1772852557985-abd1a79ee660?w=900&auto=format&fit=crop&q=60',
            imageUrl: 'https://images.unsplash.com/photo-1772852557985-abd1a79ee660?w=900&auto=format&fit=crop&q=60',
            category: 'food',
            images: [
                'https://images.unsplash.com/photo-1772852557985-abd1a79ee660?w=900&auto=format&fit=crop&q=60',
                'https://images.unsplash.com/photo-1772852557026-07d05614f0a8?w=900&auto=format&fit=crop&q=60'
            ],
            badges: ['Homemade', 'Natural Ingredients', 'No Preservatives', 'Spicy & Tangy', 'Chef Homemade', 'Fresh Batch'],
            tags: ['Homemade', 'Natural Ingredients', 'No Preservatives', 'Spicy & Tangy', 'Chef Homemade', 'Fresh Batch'],
        }
    });

    console.log({ user, seller, productsCount: 4, categoriesCount: categoriesData.length, sampleSeller, sampleProduct, sample, currySeller, curryProduct });
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
