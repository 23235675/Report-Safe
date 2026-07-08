// Run the API server against an ephemeral in-memory MongoDB — for machines
// without Docker / a local mongod (mirrors scripts/test-with-memory-db.mjs).
//
// Usage: node scripts/dev-with-memory-db.mjs   (from the repo root)
//
// The server auto-seeds demo data, listens on :3001, and serves the built
// web/dist same-origin. GOV_TOKEN is set to 'dev-bypass' so the web /gov
// localhost bypass authenticates automatically; a super_admin is provisioned
// for the /admin console login (creds printed below).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('[dev:memdb] starting ephemeral MongoDB (first run downloads mongod)…');
const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri().replace(/\/$/, '');
console.log(`[dev:memdb] ephemeral MongoDB at ${uri}`);

const ADMIN_PHONE = '+85299990000';
const ADMIN_PASSWORD = 'ReportSafe2026';

const child = spawn(process.execPath, ['server/src/index.js'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    MONGODB_URI: uri,
    MONGODB_DB: 'reportsafe_dev',
    PORT: '3001',
    NODE_ENV: 'development',
    GOV_TOKEN: 'dev-bypass',
    SUPER_ADMIN_PHONE: ADMIN_PHONE,
    SUPER_ADMIN_PASSWORD: ADMIN_PASSWORD,
    SUPER_ADMIN_NAME: 'Dev Admin',
  },
});

console.log('[dev:memdb] API on http://localhost:3001  (also serves the built web)');
console.log(`[dev:memdb] /admin login → phone ${ADMIN_PHONE}  password ${ADMIN_PASSWORD}`);
console.log('[dev:memdb] /gov authenticates automatically on localhost.');

async function stop(code) {
  try { child.kill('SIGINT'); } catch { /* already gone */ }
  try { await mongod.stop(); } catch { /* already stopped */ }
  process.exit(code ?? 0);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
child.on('exit', (code) => stop(code ?? 0));
