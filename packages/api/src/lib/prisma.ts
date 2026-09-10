import { PrismaClient } from '../generated/prisma/client';

// Reuse a single client across hot reloads / requests.
export const prisma = new PrismaClient();
