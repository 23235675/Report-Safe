// Run the full test suite against an ephemeral in-memory MongoDB — for
// machines without Docker. The Redis suite self-skips (NO_REDIS=1 stops
// tests/_env.setup.js from defaulting REDIS_HOST to localhost).
//
// Usage: npm run test:memdb   (from the repo root)
import { spawn } from 'node:child_process';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri().replace(/\/$/, '');
console.log(`[test:memdb] ephemeral MongoDB at ${uri}`);

const child = spawn('npx', ['vitest', 'run'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, TEST_MONGODB_URI: uri, NO_REDIS: '1' },
});

child.on('exit', async (code) => {
  await mongod.stop();
  process.exit(code ?? 1);
});
