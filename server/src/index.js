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
const { seed }              = require('./db/seed');
const { getStats }          = require('./services/reportStore');
const { logger, requestLogger } = require('./lib/logger');
const { securityHeaders, corsOptions } = require('./lib/httpSecurity');
const { rateLimit, setRedisClient } = require('./lib/rateLimit');
const { connectRedisPair }  = require('./lib/redisClient');
const realtimeService       = require('./services/realtimeService');
const triggerEngine         = require('./services/triggerEngine');
const missingPersonService  = require('./services/missingPersonService');
const retentionService      = require('./services/retentionService');
const createReportsRouter   = require('./routes/reports');
const createDisastersRouter = require('./routes/disasters');
const createSheltersRouter  = require('./routes/shelters');
const createUsersRouter     = require('./routes/users');
const createSafePlacesRouter = require('./routes/safePlaces');
const createDevicesRouter   = require('./routes/devices');
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
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);
  app.use(securityHeaders);
  app.use(cors(corsOptions()));
  app.use(requestLogger);
  app.use(express.json({ limit: '2mb' }));

  // Coarse global API rate limit (M2). Per-route stricter limits live in the
  // user router (register/links). Per-instance — back with Redis when scaling.
  app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_PER_MIN) || 300,
  }));

  // 4. HTTP server + Socket.IO (with Redis adapter when available)
  const server = http.createServer(app);
  const io     = realtimeService.initSocketIO(server, redisPair);

  // 5. Health check
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

  // 8. Start the disaster trigger engine
  triggerEngine.startPolling(io);

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
    missingPersonService.stopEscalation?.();
    retentionService.stopRetention?.();
    realtimeService.stopStatsTimer?.();
    server.close(() => logger.info('http_closed'));
    try { await closeDb(); } catch (err) { logger.error('pool_close_failed', { error: err.message }); }
    // Close Redis connections last (adapter uses them until socket.io closes).
    if (redisPair) {
      try { await redisPair.pub.quit(); } catch (_) {}
      try { await redisPair.sub.quit(); } catch (_) {}
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
