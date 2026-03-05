import "dotenv/config";

import { buildLogger, buildMetrics, loadConfig, redactUnknown } from "@mercari-bot/core";
import { createPrismaClient, initPrisma } from "@mercari-bot/db";

import { createApi } from "./api.js";
import { startNotificationProcessor } from "./notifier.js";
import { startScheduler } from "./scheduler.js";
import { syncConfigFromDisk } from "./sync.js";

const config = loadConfig();
const logger = buildLogger(config.LOG_LEVEL);
const metrics = buildMetrics();
const prisma = createPrismaClient();

const deps = { config, logger, metrics, prisma };

async function main(): Promise<void> {
  await initPrisma(prisma);
  await syncConfigFromDisk(prisma, logger, config);

  const app = createApi(deps);
  await app.listen({ host: "0.0.0.0", port: config.PORT });
  logger.info({ port: config.PORT }, "API started");

  const scheduler = startScheduler(deps);
  const notifier = startNotificationProcessor(deps);

  const shutdown = async () => {
    logger.info("Shutting down…");
    scheduler.stop();
    notifier.stop();
    await app.close();
    await prisma.$disconnect();
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      logger.info({ signal }, "Received shutdown signal");
      void shutdown().finally(() => process.exit(0));
    });
  }
}

main().catch((error) => {
  logger.error({ error: redactUnknown(error) }, "Failed to start");
  process.exit(1);
});
