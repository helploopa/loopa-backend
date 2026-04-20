import { prisma } from './src/context';

async function main() {
    const orders = await prisma.order.findMany({ include: { items: true } });
    console.log(JSON.stringify(orders, null, 2));
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
