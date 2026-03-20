const { PrismaClient } = require('@prisma/client');

async function main() {
    const prisma = new PrismaClient();
    const users = await prisma.user.findMany({
        where: { role: 'SELLER' },
        take: 5
    });
    console.log("Found Sellers:");
    console.log(users.map(u => ({ email: u.email, role: u.role, id: u.id, sellerId: u.sellerId })));
    await prisma.$disconnect();
}

main().catch(console.error);
