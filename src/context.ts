import { PrismaClient, User } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { verifyToken } from './firebase';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'development-mock-secret';

const connectionString = `${process.env.DATABASE_URL}`;

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

export interface Context {
    prisma: PrismaClient;
    user?: User;
}

export const context = async ({ req }: { req: any }): Promise<Context> => {
    const token = req.headers.authorization || '';
    let user: User | undefined;

    if (token) {
        const idToken = token.startsWith('Bearer ') ? token.slice(7) : token;

        // 1. Try resolving with our custom JWT mock for development
        try {
            const decodedJwt = jwt.verify(idToken, JWT_SECRET) as any;
            if (decodedJwt && decodedJwt.email) {
                user = await prisma.user.findUnique({ where: { email: decodedJwt.email } }) || undefined;
                return { prisma, user };
            }
        } catch (e) {
            // Fallthrough to Firebase behavior if not our mock token
        }

        // 2. Try resolving with Firebase
        const decodedToken = await verifyToken(idToken);

        if (decodedToken) {
            const { email, name, picture } = decodedToken;

            if (email) {
                // Find or create user
                user = await prisma.user.upsert({
                    where: { email },
                    update: {}, // No updates on login for now, maybe update name/avatar later
                    create: {
                        email,
                        name: name || 'User',
                        password: '', // Social login users don't have a password
                    },
                });
            }
        }
    }

    return {
        prisma,
        user,
    };
};
