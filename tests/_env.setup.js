// Test environment guard — runs before every test file.
//
// SAFETY: the suites below DELETE documents and seed schema. They must only ever
// hit a disposable local MongoDB, NEVER the production/cloud Cosmos DB configured
// in server/.env (MONGODB_URI). We force the MONGODB_* variables to the local
// docker-compose instance (npm run db:up) and an isolated test database.
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017';
// Isolated test database (dropped by tests/_global.setup.js) so destructive
// suites never wipe the development `reportsafe` data.
process.env.MONGODB_DB  = process.env.TEST_MONGODB_DB  || 'reportsafe_test';

// Redis — tests opt-in by setting REDIS_HOST (or REDIS_URL) in the environment.
// docker-compose redis service is on localhost:6379 by default. The redis.test.js
// suite uses describe.skipIf(!REDIS_HOST) so it self-skips when Redis is absent.
// Don't clobber an explicit caller override (e.g. CI sets REDIS_HOST=localhost).
// NO_REDIS=1 (set by scripts/test-with-memory-db.mjs on machines with no Redis)
// suppresses the localhost default so the redis suite's self-skip actually fires.
if (!process.env.REDIS_HOST && !process.env.REDIS_URL && process.env.NO_REDIS !== '1') {
  // Local dev: default to the docker-compose Redis.
  process.env.REDIS_HOST = 'localhost';
  process.env.REDIS_PORT = '6379';
}
