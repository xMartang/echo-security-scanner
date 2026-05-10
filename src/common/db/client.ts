import { PrismaClient } from '@prisma/client';

// Singleton -- only place in the codebase that instantiates PrismaClient.
// Reads DATABASE_URL directly from process.env (set via dotenv before first import).
export const prisma = new PrismaClient();
