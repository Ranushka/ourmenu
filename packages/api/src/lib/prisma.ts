import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// Prisma 7 requires an explicit driver adapter — no built-in query engine.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Reuse a single client across hot reloads / requests.
export const prisma = new PrismaClient({ adapter });
