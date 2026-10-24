import mongoose from 'mongoose';
import { afterAll, beforeAll, inject } from 'vitest';
import { connectDb, disconnectDb } from '../src/db.js';
import { seedDatabase } from '../src/seed/seed.js';

// Each test file gets its own database with freshly seeded, published content.
beforeAll(async () => {
  await connectDb(inject('mongoUri'), `certpath_test_${process.pid}_${Date.now()}`);
  await seedDatabase({ publish: true, accounts: true });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectDb();
});
