import mongoose, { type ClientSession } from 'mongoose';
import './models/index.js';

// Operations inside connection.transaction() pick up the session automatically.
mongoose.set('transactionAsyncLocalStorage', true);
mongoose.set('strictQuery', true);

export async function connectDb(uri: string, dbName?: string) {
  await mongoose.connect(uri, { autoIndex: true, ...(dbName && { dbName }) });
  // Unique indexes carry idempotency guarantees, so wait until they exist.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

/**
 * Runs fn in a multi-document transaction, retrying on transient write conflicts.
 * Do not run operations in parallel (Promise.all) inside fn.
 */
export function tx<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  return mongoose.connection.transaction(fn, {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
  });
}
