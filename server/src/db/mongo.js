'use strict';

const { MongoClient } = require('mongodb');

/*
 * MongoDB connection module — the single shared MongoClient for the whole app.
 * Replaces the former PostgreSQL `pg.Pool` (db/pool.js).
 *
 * Target: Azure Cosmos DB for MongoDB (RU-based, serverless, API v7.0), but the
 * code is plain MongoDB and also runs against a local `mongod` for testing.
 *
 * Configuration (see `.env.example`):
 *   MONGODB_URI   — full connection string (preferred). For Cosmos this is the
 *                   account's "Primary Connection String" and ALREADY contains
 *                   `ssl=true&retrywrites=false&...`. For local dev:
 *                   mongodb://localhost:27017
 *   MONGODB_DB    — database (collection namespace) name. Default 'reportsafe'.
 *
 * COSMOS NOTES:
 *   - retryWrites MUST be false (Cosmos RU-based rejects retryable writes). The
 *     Cosmos connection string sets this; we also force it in options as a
 *     belt-and-suspenders for hand-built URIs.
 *   - TLS is required (the Cosmos URI sets ssl=true).
 */

/** @type {import('mongodb').MongoClient | null} */
let client = null;
/** @type {import('mongodb').Db | null} */
let db = null;

function buildUri() {
  return process.env.MONGODB_URI || 'mongodb://localhost:27017';
}

function dbName() {
  return process.env.MONGODB_DB || 'reportsafe';
}

/**
 * Connect once and cache the Db handle. Called at boot (db/setup.js → setup()).
 * @returns {Promise<import('mongodb').Db>}
 */
async function connect() {
  if (db) return db;
  client = new MongoClient(buildUri(), {
    // Cosmos RU-based does not support retryable writes — must be off.
    retryWrites: false,
    maxPoolSize: Number(process.env.MONGO_POOL_MAX) || 10,
    serverSelectionTimeoutMS: Number(process.env.MONGO_CONN_TIMEOUT_MS) || 20000,
    connectTimeoutMS: Number(process.env.MONGO_CONN_TIMEOUT_MS) || 20000,
  });
  await client.connect();
  db = client.db(dbName());
  return db;
}

/**
 * Return the connected Db. Throws if connect() hasn't run — callers at request
 * time can assume boot already connected (index.js awaits setup()).
 * @returns {import('mongodb').Db}
 */
function getDb() {
  if (!db) {
    throw new Error('[db/mongo] not connected — connect() must run at boot before queries');
  }
  return db;
}

/**
 * Convenience accessor for a collection on the shared Db.
 * @param {string} name
 * @returns {import('mongodb').Collection}
 */
function collection(name) {
  return getDb().collection(name);
}

/**
 * Close the client (graceful shutdown / test teardown).
 * @returns {Promise<void>}
 */
async function closeDb() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

module.exports = { connect, getDb, collection, closeDb };
