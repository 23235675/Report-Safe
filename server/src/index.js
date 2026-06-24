'use strict';

const path = require('path');
// Load server/.env relative to THIS file, not the process CWD — so running
// `node server/src/index.js` from the repo root behaves identically to the
// `cd server && node src/index.js` npm scripts (and never silently falls back
// to the wrong PG defaults / database).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const http = require('http');
const express = require('express');
const cors = require('cors');

const { setup, closeDb }    = require('./db/setup');
const { getDb }             = require('./db/mongo');
const { seed }              = require('./db/seed');
const { getStats }          = require('./services/reportStore');
const { logger, requestLogger, getMetrics } = require('./lib/logger');
const { securityHeaders, corsOptions } = require('./lib/httpSecurity');
const { rateLimit, setRedisClient } = require('./lib/rateLimit');
const { errorHandler }      = require('./lib/errorHandler');
const { connectRedisPair }  = require('./lib/redisClient');
const realtimeService       = require('./services/realtimeService');
const triggerEngine         = require('./services/triggerEngine');
const incidentEngine        = require('./services/incidentEngine');
const missingPersonService  = require('./services/missingPersonService');
const retentionService      = require('./services/retentionService');
const createReportsRouter   = require('./routes/reports');
const createDisastersRouter = require('./routes/disasters');
const createSheltersRouter  = require('./routes/shelters');
const createUsersRouter     = require('./routes/users');
const createSafePlacesRouter = require('./routes/safePlaces');
const createDevicesRouter   = require('./routes/devices');
const createIncidentsRouter = require('./routes/incidents');
const createAedRouter       = require('./routes/aed');
const createMissingPersonsRouter = require('./routes/missingPersons');
const createAdminRouter     = require('./routes/admin');
const { seedAdmin }         = require('./db/seedAdmin');

async function bootstrap() {
  // 0. Redis — optional; falls back gracefully to single-instance behaviour.
  let redisPair = null;
  try {
    redisPair = await connectRedisPair();
    if (redisPair) {
      // Share the pub client with the rate limiter so all limiters use one
      // connection (they only need GET/INCR/PEXPIRE, not pub/sub).
      setRedisClient(redisPair.pub);
    }
  } catch (err) {
    logger.warn('redis_unavailable', { error: err.message, note: 'running single-instance' });
  }

  // 1. Database
  await setup();

  // 2. Seed demo data only if empty
  try {
    const result = await seed();
    if (result.seeded) {
      logger.info('seed_complete', { disasters: result.disasters, users: result.users });
    }
  } catch (err) {
    logger.error('seed_failed', { error: err.message });
  }

  // 2b. Provision super admin account from env vars (idempotent).
  try {
    await seedAdmin();
  } catch (err) {
    logger.error('seed_admin_failed', { error: err.message });
  }

  // 3. Express app
  const app = express();
  // trust proxy defaults to 0 (H2): trusting a hop you're not strictly behind
  // lets a spoofed X-Forwarded-For set req.ip and bypass IP rate limits. Set
  // TRUST_PROXY_HOPS to the EXACT number of trusted proxies (Azure App Service /
  // a single reverse proxy = 1).
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS) || 0;
  app.set('trust proxy', trustProxyHops);
  if (process.env.TRUST_PROXY_HOPS == null && process.env.NODE_ENV === 'production') {
    logger.warn('trust_proxy_unset', { note: 'defaulting to 0 — set TRUST_PROXY_HOPS to your proxy hop count (Azure App Service = 1)' });
  }
  app.use(securityHeaders);
  app.use(cors(corsOptions()));
  app.use(requestLogger);
  app.use(express.json({ limit: '2mb' }));

  // Coarse global API rate limit. Per-route stricter limits live in the user
  // router (register/links). Report INGEST is deliberately excluded (B2): it has
  // its own higher, user-keyed limiter in routes/reports.js so a legitimate
  // report surge can't exhaust the shared quota and block users from fetching
  // shelters / disaster status. Backed by Redis when scaling.
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_PER_MIN) || 300,
    failClosed: true, // M9: a Redis outage must not silently disable abuse protection
  });
  const LIMITER_EXEMPT = new Set(['/live', '/ready', '/metrics', '/health']);
  app.use('/api', (req, res, next) => {
    if (req.method === 'POST' && req.path === '/reports') return next(); // ingest has its own limiter (B2)
    if (LIMITER_EXEMPT.has(req.path)) return next();                     // health/metrics never throttled
    return apiLimiter(req, res, next);
  });

  // 4. HTTP server + Socket.IO (with Redis adapter when available)
  const server = http.createServer(app);
  const io     = realtimeService.initSocketIO(server, redisPair);

  // 5. Health + observability (B23). Split liveness from readiness so an
  //    orchestrator can tell "process up" from "dependencies ready":
  //      /api/live    — always 200 (is the event loop alive?)
  //      /api/ready   — 503 if Mongo or (configured) Redis is unreachable
  //      /api/metrics — request count / error rate / latency / active sockets
  //      /api/health  — legacy: liveness + stats (kept for back-compat)
  app.get('/api/live', (req, res) => res.json({ ok: true, status: 'live', uptime: process.uptime() }));

  app.get('/api/ready', async (req, res) => {
    const checks = { mongo: false, redis: 'skipped' };
    try { await getDb().command({ ping: 1 }); checks.mongo = true; } catch (_) { checks.mongo = false; }
    if (redisPair) {
      try { await redisPair.pub.ping(); checks.redis = true; } catch (_) { checks.redis = false; }
    }
    const ready = checks.mongo && checks.redis !== false;
    return res.status(ready ? 200 : 503).json({ ok: ready, checks });
  });

  app.get('/api/metrics', (req, res) => {
    res.json({
      ok: true,
      ...getMetrics(),
      active_sockets: io?.engine?.clientsCount ?? 0,
      uptime_s: Math.round(process.uptime()),
    });
  });

  app.get('/api/health', async (req, res) => {
    try {
      const stats = await getStats();
      res.json({ ok: true, stats, uptime: process.uptime() });
    } catch (err) {
      logger.error('health_check_failed', { reqId: req.id, error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 6. Mount API routes
  app.use('/api/reports',     createReportsRouter(io));
  app.use('/api/disasters',   createDisastersRouter(io));
  app.use('/api/shelters',    createSheltersRouter());
  app.use('/api/users',       createUsersRouter());
  app.use('/api/safe-places', createSafePlacesRouter());
  app.use('/api/devices',     createDevicesRouter());
  app.use('/api/incidents',   createIncidentsRouter(io));
  app.use('/api/aed',         createAedRouter());
  app.use('/api/missing-persons', createMissingPersonsRouter(io));
  app.use('/api/admin',       createAdminRouter());

  // 7. Serve the compiled Vue frontend in production.
  const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(webDist, 'index.html'), (err) => {
      if (err) res.status(200).send('Report Safe API is running. Build the web app or run Vite in dev.');
    });
  });

  // Central error handler (L6) — must be the LAST middleware.
  app.use(errorHandler);

  // 8. Start the disaster trigger engine
  triggerEngine.startPolling(io);

  // 8b. Start the optional CFR mock 999 feed (no-op unless ENABLE_MOCK_999_FEED=true)
  incidentEngine.startPolling(io);

  // 9. Start the missing person escalation engine
  missingPersonService.startEscalation(io);

  // 9b. PDPO data-retention purge job (no-op unless RETENTION_DAYS > 0)
  retentionService.startRetention();

  // 10. Listen
  const PORT = Number(process.env.PORT) || 3001;
  server.listen(PORT, () => {
    logger.info('server_listening', { url: `http://localhost:${PORT}` });
  });

  // 11. Graceful shutdown — stop timers, drain HTTP, close the pool.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown_start', { signal });
    triggerEngine.stopPolling?.();
    incidentEngine.stopPolling?.();
    missingPersonService.stopEscalation?.();
    retentionService.stopRetention?.();
    realtimeService.stopStatsTimer?.();
    server.close(() => logger.info('http_closed'));
    try { await closeDb(); } catch (err) { logger.error('pool_close_failed', { error: err.message }); }
    // Close Redis connections last (adapter uses them until socket.io closes).
    if (redisPair) {
      try { await redisPair.pub.quit(); } catch (_) { /* already closing */ }
      try { await redisPair.sub.quit(); } catch (_) { /* already closing */ }
      logger.info('redis_closed');
    }
    setTimeout(() => process.exit(0), 500).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { app, server, io };
}

if (require.main === module) {
  bootstrap().catch((err) => {
    logger.error('bootstrap_fatal', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

module.exports = { bootstrap };
