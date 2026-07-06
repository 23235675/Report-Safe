'use strict';

const express = require('express');
const { DeviceRegisterSchema } = require('../lib/zodSchemas');
const { authenticate, resolvePrincipal } = require('../lib/authGuard');
const { rateLimit } = require('../lib/rateLimit');
const { validate, asyncHandler, HttpError } = require('../lib/http');
const { errorHandler } = require('../lib/errorHandler');
const deviceStore = require('../services/deviceStore');

/**
 * Device push-token registry. A mobile device posts its native FCM/APNs handle
 * plus its last known location; a disaster trigger then direct-pushes (Azure
 * Notification Hubs) to the handles inside the radius — reaching CLOSED apps the
 * socket path can't.
 *
 * Auth is OPTIONAL on registration: an anonymous device (not yet registered as
 * a user) can still receive life-safety alerts. When a Bearer token is present
 * we associate the handle with that user so it's cleaned up on PDPO erasure.
 */
module.exports = function createDevicesRouter() {
  const router = express.Router();

  // Light limiter — devices re-register on app launch / location change.
  const deviceLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: 'Too many device updates.' });

  /** Resolve an optional Bearer token to a user id (no error if absent/invalid). */
  async function optionalUserId(req) {
    const header = req.headers['authorization'] || '';
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!m) return null;
    const p = await resolvePrincipal(m[1].trim());
    return p.kind === 'user' ? p.userId : null;
  }

  // POST /api/devices/register — upsert this device's push handle + location.
  router.post('/register', deviceLimiter, validate(DeviceRegisterSchema), asyncHandler(async (req, res) => {
    const userId = await optionalUserId(req);
    await deviceStore.upsert({ ...req.valid, userId });
    res.status(201).json({ ok: true });
  }));

  // DELETE /api/devices/:token — unregister (logout / notifications disabled).
  // Owner-scoped: only the user the handle is registered to — or a gov/admin
  // token — may remove it, so learning a token from logs/capture no longer
  // lets anyone silence that device's life-safety pushes.
  router.delete('/:token', deviceLimiter, authenticate, asyncHandler(async (req, res) => {
    const doc = await deviceStore.findOwner(req.params.token);
    if (!doc) return res.json({ ok: true }); // already gone — idempotent

    const isGov = req.auth.kind === 'gov';
    if (!isGov && doc.user_id !== req.auth.userId) {
      throw new HttpError(403, 'Forbidden — you may only unregister your own device.');
    }
    await deviceStore.remove(req.params.token);
    res.json({ ok: true });
  }));

  // Router-scoped error handler; the app-level one in index.js is the backstop.
  router.use(errorHandler);

  return router;
};
