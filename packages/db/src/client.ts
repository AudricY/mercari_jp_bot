import { PrismaClient } from "@prisma/client";

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export async function initPrisma(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL");
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
}
