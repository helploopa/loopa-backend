import { prisma } from '../src/context';

async function main() {
    let user = await prisma.user.findUnique({ where: { email: 'testcustomer@example.com' } });
    if (!user) {
        user = await prisma.user.create({
            data: {
                email: 'testcustomer@example.com',
                password: 'mock-auth-password',
                name: 'Test Customer'
            }
        });
    }
    
    // Also create a test seller
    let sellerUser = await prisma.user.findUnique({ where: { email: 'testseller@example.com' } });
    if (!sellerUser) {
        sellerUser = await prisma.user.create({
            data: {
                email: 'testseller@example.com',
                password: 'mock-auth-password',
                name: 'Test Seller',
                seller: {
                    create: {
                        name: 'Test Seller Store',
                        description: 'A mock seller',
                        latitude: 0,
                        longitude: 0
                    }
                }
            }
        });
    }

    console.log("Mock users created/verified!");
    process.exit(0);
}
main().catch(console.error);
