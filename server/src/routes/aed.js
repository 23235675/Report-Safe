'use strict';

const express = require('express');
const { collection } = require('../db/mongo');
const { boxFilter } = require('../services/reportStore');
const { haversineKm } = require('../lib/geo');
const { AedQuerySchema } = require('../lib/zodSchemas');
const { mapId } = require('../lib/mongoMap');

/**
 * Public AED (Automated External Defibrillator) registry. Seeded now; a real
 * national/NEAR registry import populates the same shape later (source field).
 * Same bounding-box + haversine geo pattern as shelters.
 */
module.exports = function createAedRouter() {
  const router = express.Router();

  // GET /api/aed?lat&lng&radius — nearest active AEDs, sorted by distance.
  router.get('/', async (req, res) => {
    const parsed = AedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { lat, lng, radius } = parsed.data;
    try {
      const docs = await collection('aed_locations').find({
        active: true,
        ...boxFilter(lat, lng, radius),
      }).toArray();
      const within = docs
        .map((d) => ({ ...mapId(d), distance_km: haversineKm(lat, lng, d.lat, d.lng) }))
        .filter((d) => d.distance_km <= radius)
        .sort((a, b) => a.distance_km - b.distance_km);
      return res.json({ ok: true, data: within });
    } catch (err) {
      console.error('[routes/aed GET /] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
