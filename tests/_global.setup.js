// Vitest global setup — runs ONCE before any test file.
//
// Drops the isolated `reportsafe_test` database so every run starts clean (the
// destructive suites DELETE between tests; a fresh drop guards against stale
// state from a previous run). MongoDB creates the database lazily on first
// write, so no explicit CREATE is needed. Idempotent and safe to run repeatedly.
const { MongoClient } = require('mongodb');

module.exports = async function () {
  const uri    = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.TEST_MONGODB_DB  || 'reportsafe_test';

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    await client.db(dbName).dropDatabase();
    console.log(`[test] dropped isolated database "${dbName}" for a clean run`);
  } finally {
    await client.close();
  }
};
