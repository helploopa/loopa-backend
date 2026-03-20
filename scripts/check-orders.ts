import { prisma } from '../src/context';

async function main() {
    const orders = await prisma.order.findMany({
        where: { customerId: '49cdcdc3-0b6e-4eb0-9a80-8fec39dd892c' }
    });
    console.log('Orders for user 49cdcdc3-0b6e-4eb0-9a80-8fec39dd892c:', orders);
}

main().catch(console.error).finally(() => prisma.$disconnect());
