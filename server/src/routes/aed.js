'use strict';

const express = require('express');
const { findWithinRadius } = require('../lib/geo');
const { AedQuerySchema } = require('../lib/zodSchemas');
const { mapId } = require('../lib/mongoMap');
const { validate, asyncHandler } = require('../lib/http');
const { errorHandler } = require('../lib/errorHandler');

/**
 * Public AED (Automated External Defibrillator) registry. Seeded now; a real
 * national/NEAR registry import populates the same shape later (source field).
 */
module.exports = function createAedRouter() {
  const router = express.Router();

  // GET /api/aed?lat&lng&radius — nearest active AEDs, sorted by distance.
  router.get('/', validate(AedQuerySchema, 'query'), asyncHandler(async (req, res) => {
    const { lat, lng, radius } = req.valid;
    const data = await findWithinRadius('aed_locations', {
      lat, lng, radiusKm: radius, filter: { active: true }, cap: null, map: mapId,
    });
    res.json({ ok: true, data });
  }));

  router.use(errorHandler);

  return router;
};
