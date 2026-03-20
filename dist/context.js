"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.context = exports.prisma = void 0;
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const firebase_1 = require("./firebase");
const connectionString = `${process.env.DATABASE_URL}`;
const pool = new pg_1.Pool({ connectionString });
const adapter = new adapter_pg_1.PrismaPg(pool);
exports.prisma = new client_1.PrismaClient({ adapter });
const context = async ({ req }) => {
    const token = req.headers.authorization || '';
    let user;
    if (token) {
        const idToken = token.startsWith('Bearer ') ? token.slice(7) : token;
        const decodedToken = await (0, firebase_1.verifyToken)(idToken);
        if (decodedToken) {
            const { email, name, picture } = decodedToken;
            if (email) {
                // Find or create user
                user = await exports.prisma.user.upsert({
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
        prisma: exports.prisma,
        user,
    };
};
exports.context = context;
