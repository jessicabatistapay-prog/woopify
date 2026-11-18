import { closeDb } from './lib/db.js';
import { migrate } from './lib/migrate.js';
import { startWorker } from './jobs/handlers.js';

async function main() {
  await migrate();
  const stop = startWorker();
  const shutdown = async () => {
    stop();
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
