import { config } from '../config.js';
import { connectDb, disconnectDb } from '../db.js';
import { seedDatabase } from './seed.js';

if (!config.MONGODB_URI) {
  console.error('Set MONGODB_URI to seed a database.');
  process.exit(1);
}
if (config.NODE_ENV === 'production') {
  console.error('Refusing to load fictional seed data in production.');
  process.exit(1);
}
await connectDb(config.MONGODB_URI);
const result = await seedDatabase({ publish: true, accounts: true });
console.log('Seeded', result);
await disconnectDb();
