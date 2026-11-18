import { buildApp } from './app.js';
import { config } from './lib/config.js';
import { closeDb } from './lib/db.js';
import { migrate } from './lib/migrate.js';
import { startWorker } from './jobs/handlers.js';
import { bootstrapShopFromEnv } from './bootstrap.js';

async function main() {
  const cfg = config();
  await migrate();
  await bootstrapShopFromEnv();
  const app = await buildApp();
  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  const stopWorker = cfg.RUN_WORKER ? startWorker((m) => app.log.info(m)) : () => undefined;
  const shutdown = async () => {
    stopWorker();
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
