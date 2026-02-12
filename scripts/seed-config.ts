import { createPrismaClient } from "@mercari-bot/db";

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  await prisma.systemConfig.upsert({
    where: { key: "daily_summary_time" },
    create: { key: "daily_summary_time", value: "12:30" },
    update: { value: "12:30" },
  });

  await prisma.systemConfig.upsert({
    where: { key: "display_timezone" },
    create: { key: "display_timezone", value: "UTC" },
    update: { value: "UTC" },
  });

  await prisma.$disconnect();
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
