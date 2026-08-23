// One-off: seed the (currently empty) Category table from the distinct
// category values already used by real, customer-facing products —
// i.e. the same population nearbyProducts serves (excludes sample,
// inactive and deleted products, which are never shown in the Discover feed).
import 'dotenv/config';
import { prisma } from '../src/context';

const ICONS: Record<string, string> = {
    Preserves: '🍯',
    Bread: '🍞',
    Other: '🛍️',
};

async function main() {
    const products = await prisma.product.findMany({
        where: { sampleProduct: false, sampler: false, isActive: true, deletedAt: null, category: { not: null } },
        select: { category: true },
    });

    const distinct = Array.from(new Set(products.map(p => p.category as string))).sort();
    console.log('[seed-categories] distinct customer-facing categories:', distinct);

    for (const label of distinct) {
        const existing = await prisma.category.findFirst({ where: { label: { equals: label, mode: 'insensitive' } } });
        if (existing) {
            console.log(`[seed-categories] skip "${label}" — already exists (${existing.id})`);
            continue;
        }
        const created = await prisma.category.create({
            data: { label, icon: ICONS[label] ?? '🏷️', isActive: true },
        });
        console.log(`[seed-categories] created "${label}" (${created.id})`);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
