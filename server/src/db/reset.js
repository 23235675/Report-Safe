'use strict';

// Load server/.env relative to this file (not the CWD) so the target database
// is resolved consistently however the script is invoked.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

/*
 * DESTRUCTIVE database reset.
 *
 *   node src/db/reset.js --yes        (or: npm run db:reset -- --yes)
 *
 * Wipes EVERY document from EVERY collection (reports, users, shelters,
 * disasters, history, audit logs, links — all of it), then re-applies the
 * schema (collections + indexes) and the Hong Kong seed (HK disasters + ~10k
 * random HK users).
 *
 * The target database comes from the environment (MONGODB_URI / MONGODB_DB),
 * exactly like the server itself — check the printed target before confirming.
 */

const { setup, COLLECTIONS } = require('./setup');
const { seed } = require('./seed');
const { collection, closeDb } = require('./mongo');

function describeTarget() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const db  = process.env.MONGODB_DB || 'reportsafe';
  try {
    const u = new URL(uri);
    return `${u.hostname}${u.port ? ':' + u.port : ''}/${db}`;
  } catch {
    return `${uri}/${db}`;
  }
}

async function reset() {
  const target = describeTarget();
  console.log(`[db/reset] target database: ${target}`);

  if (!process.argv.includes('--yes')) {
    console.error('[db/reset] REFUSING to run without explicit confirmation.');
    console.error('[db/reset] This DELETES ALL DATA in the database above, then re-seeds');
    console.error('[db/reset] HK disasters + random HK users only.');
    console.error('[db/reset] Re-run with:  npm run db:reset -- --yes');
    process.exitCode = 1;
    return;
  }

  // Ensure schema exists first (fresh databases), then wipe and re-seed.
  await setup();

  // Every collection — clearing each one is the blast radius.
  console.log(`[db/reset] clearing ${COLLECTIONS.length} collections ...`);
  for (const name of COLLECTIONS) {
    await collection(name).deleteMany({});
  }

  const result = await seed();
  console.log(
    `[db/reset] done — ${result.disasters} HK disasters, ${result.users} HK users. ` +
    'All other collections are empty; the app now relies fully on live database data.'
  );
}

reset()
  .catch((err) => {
    console.error('[db/reset] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
