import { prisma } from '../src/context';

async function main() {
    const result = await prisma.product.findFirst({
        include: { seller: true }
    });
    console.log('Location variables for getNearbyProducts:');
    console.log(JSON.stringify({
        category: result?.category || "Food",
        location: {
            latitude: result?.seller.latitude,
            longitude: result?.seller.longitude,
            radius_miles: 10
        }
    }, null, 2));
}

main().finally(() => prisma.$disconnect());
