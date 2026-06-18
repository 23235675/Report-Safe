'use strict';

const express = require('express');
const crypto  = require('crypto');
const { collection } = require('../db/mongo');
const { DeviceRegisterSchema } = require('../lib/zodSchemas');
const { authenticate } = require('../lib/authGuard');
const { rateLimit } = require('../lib/rateLimit');

/**
 * Device push-token registry. A mobile device posts its native FCM/APNs handle
 * plus its last known location; a disaster trigger then direct-pushes (Azure
 * Notification Hubs) to the handles inside the radius — reaching CLOSED apps the
 * socket path can't. The token is upserted (one row per handle) and its location
 * refreshed on every call so targeting stays current.
 *
 * Auth is OPTIONAL: an anonymous device (not yet registered as a user) can still
 * receive life-safety alerts. When a Bearer token is present we associate the
 * handle with that user so it's cleaned up on PDPO erasure (ON DELETE CASCADE).
 */
module.exports = function createDevicesRouter() {
  const router = express.Router();

  // Light limiter — devices re-register on app launch / location change.
  const deviceLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: 'Too many device updates.' });

  /** Resolve an optional Bearer token to a user id (no error if absent/invalid). */
  async function optionalUserId(req) {
    return new Promise((resolve) => {
      const hasAuth = !!req.headers['authorization'];
      if (!hasAuth) return resolve(null);
      authenticate(req, { status: () => ({ json: () => resolve(null) }) }, () => {
        resolve(req.auth?.userId ?? null);
      });
    });
  }

  // POST /api/devices/register — upsert this device's push handle + location.
  router.post('/register', deviceLimiter, async (req, res) => {
    const parsed = DeviceRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { token, platform, lat, lng } = parsed.data;
    try {
      const userId = await optionalUserId(req);
      const now = Date.now();
      // Upsert by token (the former ON CONFLICT (token) DO UPDATE). user_id uses
      // COALESCE semantics: a provided id overwrites, an absent one keeps prior.
      const setOnInsert = { _id: crypto.randomUUID(), created_at: now };
      const set = { platform, lat: lat ?? null, lng: lng ?? null, updated_at: now };
      if (userId != null) set.user_id = userId; else setOnInsert.user_id = null;

      const tokens = collection('device_push_tokens');
      try {
        await tokens.updateOne({ token }, { $setOnInsert: setOnInsert, $set: set }, { upsert: true });
      } catch (err) {
        // Lost an insert race on the unique token → the row now exists; update it.
        if (err.code === 11000) await tokens.updateOne({ token }, { $set: set });
        else throw err;
      }
      return res.status(201).json({ ok: true });
    } catch (err) {
      console.error('[devices POST /register] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/devices/:token — unregister (logout / notifications disabled).
  router.delete('/:token', deviceLimiter, async (req, res) => {
    try {
      await collection('device_push_tokens').deleteOne({ token: req.params.token });
      return res.json({ ok: true });
    } catch (err) {
      console.error('[devices DELETE /:token] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
