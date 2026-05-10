
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 3958.8; // Radius of Earth in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

async function checkEligibility() {
    const userId = "91aa1ea2-9ffb-433a-9f66-c831a867900f"; // Brenda Ramirez
    const lat = 38.83473026367965;
    const lng = -121.26297615981115;
    const RADIUS_MILES = 10;

    console.log(`Checking eligibility for user ${userId} at (${lat}, ${lng})`);

    // Gate 1: Sampling Enabled
    const samplingFeatures = await prisma.sellerFeature.findMany({
        where: { featureKey: 'sampling', enabled: true },
        include: { seller: true }
    });
    console.log(`Gate 1: ${samplingFeatures.length} sellers have sampling enabled.`);

    // Gate 2: Past Orders
    const pastOrders = await prisma.order.findMany({
        where: { customerId: userId },
        select: { sellerId: true }
    });
    const pastOrderSellerIds = new Set(pastOrders.map(o => o.sellerId));
    console.log(`Gate 2: User has purchased from ${pastOrderSellerIds.size} sellers.`);

    // Gate 3: Past Samples
    const pastSamples = await prisma.sample.findMany({
        where: { claimedByUserId: userId },
        select: { sellerId: true }
    });
    const pastSampleSellerIds = new Set(pastSamples.map(s => s.sellerId));
    console.log(`Gate 3: User has sampled from ${pastSampleSellerIds.size} sellers.`);

    const excludedSellerIds = new Set([...pastOrderSellerIds, ...pastSampleSellerIds]);

    for (const feature of samplingFeatures) {
        const seller = feature.seller;
        const distance = calculateDistance(lat, lng, seller.latitude, seller.longitude);
        const isExcluded = excludedSellerIds.has(seller.id);
        const isNearby = distance <= RADIUS_MILES;

        console.log(`\nSeller: ${seller.name} (ID: ${seller.id})`);
        console.log(`  Location: (${seller.latitude}, ${seller.longitude})`);
        console.log(`  Distance: ${distance.toFixed(2)} miles`);
        console.log(`  Gate 1 (Enabled): PASS`);
        console.log(`  Gate 2 & 3 (New to Seller): ${isExcluded ? 'FAIL' : 'PASS'} (Reason: ${isExcluded ? 'Already purchased/sampled' : 'No prior history'})`);
        console.log(`  Gate 4 (Nearby): ${isNearby ? 'PASS' : 'FAIL'} (Reason: ${isNearby ? 'Within 10 miles' : 'Outside 10 miles'})`);
        
        if (!isExcluded && isNearby) {
            const products = await prisma.product.findMany({
                where: { sellerId: seller.id, isActive: true }
            });
            console.log(`  Final Result: ELIGIBLE (${products.length} products found)`);
        } else {
            console.log(`  Final Result: INELIGIBLE`);
        }
    }

    await prisma.$disconnect();
}

checkEligibility();
