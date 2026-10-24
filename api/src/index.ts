import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb, disconnectDb } from './db.js';
import { startWorkers } from './workers/index.js';

async function main() {
  if (!config.MONGODB_URI) {
    console.error('MONGODB_URI is required. For local development use `npm run dev`, which starts an in-memory replica set.');
    process.exit(1);
  }
  await connectDb(config.MONGODB_URI);
  const server = createApp().listen(config.PORT, () => console.log(`CertPath API listening on :${config.PORT}`));
  const stopWorkers = config.WORKERS_ENABLED ? startWorkers() : () => undefined;

  const shutdown = async () => {
    stopWorkers();
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
