/**
 * Local development entrypoint. With MONGODB_URI unset it starts a throwaway
 * in-memory MongoDB replica set (transactions need one) and seeds it.
 */
import { config } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';
import { seedDatabase } from './seed/seed.js';
import { startWorkers } from './workers/index.js';

let uri = config.MONGODB_URI;
if (!uri) {
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  uri = replSet.getUri('certpath');
  console.log('Started in-memory MongoDB replica set (data is discarded on exit).');
}
await connectDb(uri);
const seeded = await seedDatabase({ publish: true, accounts: true });
createApp().listen(config.PORT, '0.0.0.0', () => {
  console.log(`CertPath API on http://localhost:${config.PORT}/v1`);
  console.log(`  admin:   ${config.SEED_ADMIN_EMAIL} / ${config.SEED_ADMIN_PASSWORD}`);
  console.log(`  learner: ${config.SEED_DEMO_EMAIL} / ${config.SEED_DEMO_PASSWORD}`);
  console.log(`  exam version: ${seeded.examVersionId}`);
});
if (config.WORKERS_ENABLED) startWorkers();
