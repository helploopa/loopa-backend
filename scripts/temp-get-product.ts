import { prisma } from '../src/context';
async function main() {
    const product = await prisma.product.findFirst();
    if (product) {
        console.log(product.id);
    }
}
main().catch(() => {}).finally(() => prisma.$disconnect());
