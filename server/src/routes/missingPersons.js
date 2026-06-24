'use strict';

const express = require('express');
const crypto  = require('crypto');
const { collection } = require('../db/mongo');
const { allowGovOrVolunteer } = require('../lib/authGuard');
const { MissingPersonCreateSchema, MissingPersonUpdateSchema } = require('../lib/zodSchemas');
const { logAudit } = require('../lib/audit');
const realtimeService = require('../services/realtimeService');
const { mapId, unwrap } = require('../lib/mongoMap');

/**
 * Missing-person case management (B19). The escalation engine promotes silent
 * reports to `potentially_missing`, but nothing tracked the resulting cases —
 * the missing_person_cases collection was created and indexed yet never used,
 * and broadcastMissingAlert was dead. This router activates both. All writes
 * require a gov or volunteer principal; citizens cannot open or change cases.
 */
module.exports = function createMissingPersonsRouter(io) {
  const router = express.Router();

  // GET /api/missing-persons?status= — list cases (default: open ones).
  router.get('/', allowGovOrVolunteer, async (req, res) => {
    try {
      const status = req.query.status;
      const filter = status ? { case_status: String(status) } : { case_status: { $in: ['active', 'investigating'] } };
      const docs = await collection('missing_person_cases')
        .find(filter).sort({ created_at: -1 }).limit(500).toArray();
      return res.json({ ok: true, data: docs.map(mapId) });
    } catch (err) {
      console.error('[missingPersons GET /] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/missing-persons — open a case (optionally linked to a report).
  router.post('/', allowGovOrVolunteer, async (req, res) => {
    const parsed = MissingPersonCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    try {
      const now = Date.now();
      const doc = {
        _id: crypto.randomUUID(),
        report_id: parsed.data.report_id ?? null,
        name: parsed.data.name,
        notes: parsed.data.notes ?? null,
        last_seen_lat: parsed.data.last_seen_lat ?? null,
        last_seen_lng: parsed.data.last_seen_lng ?? null,
        case_status: 'active',
        opened_by: req.auth.kind === 'gov' ? 'gov-token' : req.auth.userId,
        created_at: now,
        updated_at: now,
      };
      await collection('missing_person_cases').insertOne(doc);
      // Activate the previously-dead missing_alert socket event (L3).
      realtimeService.broadcastMissingAlert(io, [doc._id]);
      logAudit({ action: 'missing_person.open', entity: 'missing_person_cases', entityId: doc._id, details: { report_id: doc.report_id } });
      return res.status(201).json({ ok: true, data: mapId(doc) });
    } catch (err) {
      console.error('[missingPersons POST /] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/missing-persons/:id — update status / notes.
  router.put('/:id', allowGovOrVolunteer, async (req, res) => {
    const parsed = MissingPersonUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    try {
      const set = { updated_at: Date.now() };
      if (parsed.data.case_status != null) set.case_status = parsed.data.case_status;
      if (parsed.data.notes != null) set.notes = parsed.data.notes;
      const result = await collection('missing_person_cases').findOneAndUpdate(
        { _id: req.params.id }, { $set: set }, { returnDocument: 'after' }
      );
      const doc = unwrap(result);
      if (!doc) return res.status(404).json({ error: 'Case not found' });
      logAudit({ action: 'missing_person.update', entity: 'missing_person_cases', entityId: req.params.id, details: set });
      return res.json({ ok: true, data: mapId(doc) });
    } catch (err) {
      console.error('[missingPersons PUT /:id] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/missing-persons/:id — close/archive (soft: case_status='closed').
  router.delete('/:id', allowGovOrVolunteer, async (req, res) => {
    try {
      const result = await collection('missing_person_cases').findOneAndUpdate(
        { _id: req.params.id },
        { $set: { case_status: 'closed', updated_at: Date.now() } },
        { returnDocument: 'after' }
      );
      const doc = unwrap(result);
      if (!doc) return res.status(404).json({ error: 'Case not found' });
      logAudit({ action: 'missing_person.close', entity: 'missing_person_cases', entityId: req.params.id });
      return res.json({ ok: true });
    } catch (err) {
      console.error('[missingPersons DELETE /:id] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
