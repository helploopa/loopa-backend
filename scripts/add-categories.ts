// One-off: add new categories to the Category table (not derived from
// existing product data — these are proactive additions for future listings).
import 'dotenv/config';
import { prisma } from '../src/context';

const NEW_CATEGORIES: { label: string; icon: string }[] = [
    { label: 'Gifts', icon: '🎁' },
    { label: 'Home Services', icon: '🧰' },
    { label: 'Art', icon: '🎨' },
    { label: 'Body', icon: '🧼' },
];

async function main() {
    for (const { label, icon } of NEW_CATEGORIES) {
        const existing = await prisma.category.findFirst({ where: { label: { equals: label, mode: 'insensitive' } } });
        if (existing) {
            console.log(`[add-categories] skip "${label}" — already exists (${existing.id})`);
            continue;
        }
        const created = await prisma.category.create({ data: { label, icon, isActive: true } });
        console.log(`[add-categories] created "${label}" (${created.id})`);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
