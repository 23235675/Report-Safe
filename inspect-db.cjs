'use strict';
// READ-ONLY inspection of the active PostgreSQL DB (server/.env DATABASE_URL).
// No writes. Aggregates only — does not dump raw PII.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envText = fs.readFileSync(path.join(__dirname, 'server', '.env'), 'utf8');
const m = envText.match(/^DATABASE_URL=(.+)$/m);
if (!m) { console.error('No DATABASE_URL in server/.env'); process.exit(1); }
const connectionString = m[1].trim();

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 20000,
});

const q = (text, params) => client.query(text, params);

async function safeAgg(label, sql) {
  try { const r = await q(sql); return { label, rows: r.rows }; }
  catch (e) { return { label, error: e.message }; }
}

async function main() {
  await client.connect();
  const out = {};

  out.meta = (await q(`SELECT current_database() AS db, current_user AS usr,
    (SELECT setting FROM pg_settings WHERE name='server_version') AS pg_version`)).rows[0];

  out.extensions = (await q(`SELECT extname FROM pg_extension ORDER BY extname`)).rows.map(r => r.extname);

  out.tables = (await q(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).rows.map(r => r.table_name);

  out.columns = (await q(`SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema='public'
    ORDER BY table_name, ordinal_position`)).rows;

  out.pks = (await q(`SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
    WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public'
    ORDER BY tc.table_name`)).rows;

  out.fks = (await q(`SELECT tc.table_name AS from_table, kcu.column_name AS from_col,
           ccu.table_name AS to_table, ccu.column_name AS to_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name=tc.constraint_name AND kcu.constraint_name=tc.constraint_name AND tc.table_schema=kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
    GROUP BY tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name
    ORDER BY from_table`)).rows;

  // Row counts per table
  out.counts = {};
  for (const t of out.tables) {
    try { out.counts[t] = (await q(`SELECT COUNT(*)::int AS c FROM "${t}"`)).rows[0].c; }
    catch (e) { out.counts[t] = `ERR: ${e.message}`; }
  }

  // Content aggregates (no raw PII)
  out.agg = [];
  out.agg.push(await safeAgg('reports_by_status', `SELECT status, COUNT(*)::int AS n FROM reports GROUP BY status ORDER BY n DESC`));
  out.agg.push(await safeAgg('reports_by_user_type', `SELECT COALESCE(user_type,'(null)') AS user_type, COUNT(*)::int AS n FROM reports GROUP BY user_type`));
  out.agg.push(await safeAgg('reports_pii_presence', `SELECT
      COUNT(*)::int AS total,
      COUNT(phone)::int AS with_phone,
      COUNT(medical_notes)::int AS with_medical,
      COUNT(user_id)::int AS with_user_id,
      SUM(CASE WHEN reported_by='family' THEN 1 ELSE 0 END)::int AS family_reported
    FROM reports`));
  out.agg.push(await safeAgg('reports_time_range', `SELECT MIN(created_at) AS min_created, MAX(created_at) AS max_created FROM reports`));
  out.agg.push(await safeAgg('disasters', `SELECT type, active, COUNT(*)::int AS n FROM disasters GROUP BY type, active ORDER BY type`));
  out.agg.push(await safeAgg('shelters_by_type', `SELECT type, COUNT(*)::int AS n FROM shelters GROUP BY type`));
  out.agg.push(await safeAgg('shelters_by_source', `SELECT COALESCE(source,'(null)') AS source, COUNT(*)::int AS n FROM shelters GROUP BY source`));
  out.agg.push(await safeAgg('users_by_role_type', `SELECT role, user_type, COUNT(*)::int AS n FROM users GROUP BY role, user_type`));
  out.agg.push(await safeAgg('users_consent', `SELECT privacy_consent, COUNT(*)::int AS n FROM users GROUP BY privacy_consent`));
  out.agg.push(await safeAgg('account_links_by_status', `SELECT status, COUNT(*)::int AS n FROM account_links GROUP BY status`));

  console.log('===JSON_START===');
  console.log(JSON.stringify(out, null, 2));
  console.log('===JSON_END===');
}

main()
  .catch((e) => { console.error('INSPECT_ERROR:', e.message); process.exitCode = 1; })
  .finally(async () => { try { await client.end(); } catch {} });
