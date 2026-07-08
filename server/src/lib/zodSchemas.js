'use strict';

const { z } = require('zod');
const { normalizePhone } = require('../../../shared/phone');
const { normalizeHKID, isValidHKID, isValidHKIDChecksum } = require('../../../shared/hkid');
const { REPORT_STATUSES } = require('../../../shared/statuses');

const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);

const phoneSchema = z
  .string()
  .refine((v) => String(v).replace(/\D/g, '').length >= 8,
    'Enter a valid Hong Kong phone number (at least 8 digits).')
  .transform(normalizePhone);

/*
 * HKID validation lives in shared/hkid.js (single source of truth, PCPD Code
 * of Practice applies — never expose an HKID publicly). Lenient by default;
 * the strict mod-11 checksum is always present and enforced via HKID_STRICT.
 * The synthetic HKIDs produced by db/seed.js are checksum-valid, so strict
 * mode accepts them.
 */

/** Active HKID validator: strict mod-11 when HKID_STRICT=true, else lenient. */
function hkidIsValid(raw) {
  return process.env.HKID_STRICT === 'true'
    ? isValidHKIDChecksum(raw)
    : isValidHKID(raw);
}

/**
 * Optional-but-validated HKID. Lenient by default (testers don't need a real
 * ID); set HKID_STRICT=true to enforce the full check-digit algorithm above.
 */
const personalIdSchema = z
  .string()
  .min(7)
  .max(12)
  .refine(hkidIsValid, 'Invalid HKID number (expected format like A123456(7)).')
  .transform(normalizeHKID);

/**
 * Validates the body of POST /api/reports.
 * `id` is optional — the server generates one if omitted.
 * `reported_by` = 'family' when a family member submits on behalf of someone.
 * `reporter_name` = the submitter's name when reported_by = 'family'.
 */
const ReportSchema = z.object({
  id:            z.string().min(1).optional(),
  name:          z.string().min(1, 'name is required').max(120),
  status:        z.enum(REPORT_STATUSES),
  // lat/lng are optional at the schema layer: a web PROXY report carries no
  // location of its own (A6) — the server resolves it from the affected
  // person. The reports route still REQUIRES coordinates for self/mobile reports.
  lat:           latSchema.optional().nullable(),
  lng:           lngSchema.optional().nullable(),
  medical_notes: z.string().max(2000).optional().nullable(),
  // Optional triage/urgency hint (0–5). Web proxy form maps Low/Med/High → 1/3/5;
  // absent on existing/mobile reports (back-compatible).
  severity:      z.number().int().min(0).max(5).optional().nullable(),
  // phone + personal_id are MANDATORY in the client forms; the server stays
  // lenient on absence (never-lose-a-report: legacy outbox/mesh-relayed
  // reports predating this requirement must not be rejected and dropped).
  // When personal_id IS present it must be a valid HKID.
  phone:         z.string().max(40).optional().nullable(),
  personal_id:   personalIdSchema.optional().nullable(),
  created_at:    z.number().int().positive().optional(),
  relay_count:   z.number().int().min(0).optional(),
  disaster_id:   z.string().optional().nullable(),
  reported_by:   z.enum(['self', 'family']).optional().nullable(),
  reporter_name: z.string().max(120).optional().nullable(),
  user_type:     z.enum(['mobile', 'web']).optional(),
  // Account linkage: the affected person (user_id) and, for proxy reports,
  // the person the report is filed for (reported_for_user_id).
  user_id:              z.string().optional().nullable(),
  reported_for_user_id: z.string().optional().nullable(),
});

/** Validates the body of POST /api/disasters/trigger. */
const ManualDisasterSchema = z.object({
  type:        z.string().min(1),
  magnitude:   z.number().optional().nullable(),
  severity:    z.number().int().min(0).max(5).optional().nullable(),
  lat:         latSchema,
  lng:         lngSchema,
  radius_km:   z.number().positive(),
  description: z.string().max(500).optional().nullable(),
});

/** Validates the query string of GET /api/reports/rescue. */
const RescueQuerySchema = z.object({
  lat:    z.coerce.number().min(-90).max(90),
  lng:    z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive().max(1000).default(20),
  limit:  z.coerce.number().int().positive().max(1000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Validates the query string of GET /api/reports/search (public, paginated).
 * Searches by name OR phone. If query is all-digits, tries phone first; otherwise searches name.
 */
const ReportSearchQuerySchema = z.object({
  q:      z.string().max(120).optional().default(''),
  limit:  z.coerce.number().int().positive().max(100).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Validates the query string of GET /api/shelters. */
const ShelterQuerySchema = z.object({
  lat:         z.coerce.number().min(-90).max(90).optional(),
  lng:         z.coerce.number().min(-180).max(180).optional(),
  radius:      z.coerce.number().positive().max(500).default(50),
  disaster_id: z.string().optional(),
  source:      z.enum(['government', 'volunteer', 'citizen']).optional(),
});

/** Validates POST /api/shelters body. */
const ShelterCreateSchema = z.object({
  name:          z.string().min(1).max(255),
  lat:           z.number().min(-90).max(90),
  lng:           z.number().min(-180).max(180),
  capacity:      z.number().int().positive().optional().nullable(),
  current_count: z.number().int().min(0).optional().nullable(),
  phone:         phoneSchema.optional().nullable(),
  address:       z.string().max(500).optional().nullable(),
  contact_name:  z.string().max(255).optional().nullable(),
  hours_open:    z.string().max(255).optional().nullable(),
  source:        z.enum(['government', 'volunteer', 'citizen']).default('government'),
  type:          z.enum(['shelter', 'hospital', 'clinic', 'assembly']).default('shelter'),
  disaster_id:   z.string().optional().nullable(),
});

/** Validates PUT /api/shelters/:id body. */
const ShelterUpdateSchema = z.object({
  name:          z.string().min(1).max(255).optional(),
  capacity:      z.number().int().positive().optional().nullable(),
  current_count: z.number().int().min(0).optional().nullable(),
  phone:         z.string().max(40).optional().nullable(),
  address:       z.string().max(500).optional().nullable(),
  contact_name:  z.string().max(255).optional().nullable(),
  hours_open:    z.string().max(255).optional().nullable(),
  active:        z.boolean().optional(),
});

/**
 * Validates POST /api/users/register body.
 * Phone: accepts 8 digits, auto-prepends +852.
 * Name: required.
 * HKID: required, very lenient validation (1+ letter + 6+ digits, 7-10 chars).
 * Privacy consent required (PDPO DPP1).
 */
const UserRegisterSchema = z.object({
  phone:           phoneSchema,
  name:            z.string().min(1, 'full name is required').max(255),
  gender:          z.enum(['male', 'female'], { required_error: 'gender is required' }),
  personal_id:     personalIdSchema,  // REQUIRED, very lenient validation
  email:           z.string().email().optional().nullable(),
  user_type:       z.enum(['mobile', 'web']).default('mobile'),
  // PDPO DPP1 (collection limitation): explicit consent is REQUIRED to collect
  // personal data; registration is refused without it.
  privacy_consent: z.boolean().refine((v) => v === true, {
    message: 'privacy_consent is required — personal data cannot be collected without consent (PDPO DPP1)',
  }),
});

/** Validates PATCH /api/users/:id body. */
const UserUpdateSchema = z.object({
  name:            z.string().min(1).max(255).optional().nullable(),
  gender:          z.enum(['male', 'female']).optional().nullable(),
  email:           z.string().email().optional().nullable(),
  personal_id:     personalIdSchema.optional().nullable(),
  privacy_consent: z.boolean().optional(),
});

/** Validates POST /api/users/login body (phone-only login). */
const LoginSchema = z.object({
  phone: phoneSchema,
});

/** Validates POST /api/users/:id/links body. */
const LinkRequestSchema = z.object({
  target_phone: phoneSchema,
});

/** Validates POST /api/safe-places body (citizen-submitted refuge location). */
const SafePlaceCreateSchema = z.object({
  name:        z.string().min(1).max(255),
  lat:         latSchema,
  lng:         lngSchema,
  description: z.string().max(500).optional().nullable(),
  capacity:    z.number().int().positive().optional().nullable(),
  disaster_id: z.string().optional().nullable(),
});

/** Validates the query string of GET /api/safe-places. */
const SafePlaceQuerySchema = z.object({
  lat:    z.coerce.number().min(-90).max(90).optional(),
  lng:    z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().positive().max(500).default(50),
});

/**
 * Validates POST /api/devices/register — a mobile device's native push handle
 * (FCM/APNs) plus its last known location, so a disaster trigger can push to it
 * even when the app is closed. Web devices never register (no disaster alerts).
 */
const DeviceRegisterSchema = z.object({
  token:    z.string().min(1).max(512),
  platform: z.enum(['ios', 'android', 'expo']),
  lat:      latSchema.optional().nullable(),
  lng:      lngSchema.optional().nullable(),
});

// ── Community First Responder (CFR) ──────────────────────────────────
/**
 * Validates POST /api/incidents — a 999/CAD dispatch needing nearby responders.
 * This is the single government-API integration seam: a real CAD webhook posts
 * the same shape the gov-console "simulate dispatch" button does.
 * `is_public` false = residential → restricted to verified (government) responders.
 */
const IncidentCreateSchema = z.object({
  type:      z.enum(['cardiac_arrest', 'fire', 'trauma', 'other']),
  lat:       latSchema,
  lng:       lngSchema,
  address:   z.string().max(500).optional().nullable(),
  is_public: z.boolean().default(true),
  notes:     z.string().max(1000).optional().nullable(), // dispatcher notes — NEVER patient PII
  source:    z.enum(['manual', 'mock_feed', 'gov_cad']).default('manual'),
});

/** Validates POST /api/incidents/:id/respond — a responder's status update. */
const IncidentRespondSchema = z.object({
  status:      z.enum(['enroute', 'onscene', 'declined', 'stood_down']),
  lat:         latSchema.optional().nullable(),
  lng:         lngSchema.optional().nullable(),
  eta_seconds: z.number().int().min(0).max(7200).optional().nullable(),
});

/** Validates PATCH /api/users/:id/responder — opt-in profile. */
const ResponderProfileSchema = z.object({
  responder_opt_in:        z.boolean(),
  responder_skills:        z.array(z.enum(['cpr', 'aed', 'fire'])).max(3).optional().default([]),
  // 0.4 walk / 0.8 bike / 1.5 drive — a single number, not a transport state machine.
  responder_max_radius_km: z.number().positive().max(5).optional().default(1.0),
});

/** Validates the query string of GET /api/aed (nearest public AEDs). */
const AedQuerySchema = z.object({
  lat:    z.coerce.number().min(-90).max(90),
  lng:    z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive().max(50).default(2),
});

/** Validates POST /api/missing-persons (open a case). */
const MissingPersonCreateSchema = z.object({
  report_id:     z.string().min(1).optional().nullable(),
  name:          z.string().min(1).max(120),
  notes:         z.string().max(2000).optional().nullable(),
  last_seen_lat: latSchema.optional().nullable(),
  last_seen_lng: lngSchema.optional().nullable(),
});

/** Validates PUT /api/missing-persons/:id (update a case). */
const MissingPersonUpdateSchema = z.object({
  case_status: z.enum(['active', 'investigating', 'found', 'closed']).optional(),
  notes:       z.string().max(2000).optional().nullable(),
});

// ── Super-admin CRUD bodies (/api/admin/*) ───────────────────────────
/**
 * ''/null/undefined → undefined. The admin web form submits EVERY field —
 * including empty inputs and empty selects — and the admin API has always
 * treated a blank value as "not provided" (routes/admin/shared.js `blank`).
 * Wrapping a field this way makes blanks vanish at the boundary instead of
 * failing type validation or overwriting stored values.
 */
const blankable = (schema) =>
  z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : v), schema.optional());

/*
 * The Admin* schemas validate SHAPE only. Required-field presence, enum
 * membership (VALID_ROLES / VALID_USER_TYPES / VALID_REPORT_STATUS) and the
 * cross-field business rules stay in the admin handlers, which throw
 * HttpError with the exact legacy `{ error: '…' }` messages the admin UI and
 * tests/adminRoutes.test.js assert on — a schema-level rejection would return
 * the generic `{ error: 'Validation failed', details }` envelope instead.
 * Create-schema fields are `.optional().nullable()` (no blank-wrapping) where
 * the handler's own required/enum guard must see the raw ''/null to answer
 * with its specific message, exactly as before.
 */

/** Validates POST /api/admin/users body (shape; guards live in the handler). */
const AdminUserCreateSchema = z.object({
  phone:           z.string().optional().nullable(),
  name:            z.string().optional().nullable(),
  gender:          blankable(z.enum(['male', 'female'])),
  email:           z.string().optional().nullable(),
  personal_id:     z.string().optional().nullable(),
  role:            z.string().optional().nullable(),
  user_type:       z.string().optional().nullable(),
  privacy_consent: blankable(z.boolean()),
  password:        blankable(z.string()),
});

/** Validates PUT /api/admin/users/:id body — blanks mean "keep existing". */
const AdminUserUpdateSchema = z.object({
  phone:           blankable(z.string()),
  name:            blankable(z.string()),
  gender:          blankable(z.enum(['male', 'female'])),
  email:           blankable(z.string()),
  personal_id:     blankable(z.string()),
  role:            blankable(z.string()),
  user_type:       blankable(z.string()),
  privacy_consent: blankable(z.boolean()),
  password:        blankable(z.string()),
});

/** Validates POST /api/admin/reports body (shape; guards live in the handler). */
const AdminReportCreateSchema = z.object({
  name:          z.string().optional().nullable(),
  status:        z.string().optional().nullable(),
  lat:           blankable(z.number()),
  lng:           blankable(z.number()),
  medical_notes: z.string().optional().nullable(),
  phone:         z.string().optional().nullable(),
  personal_id:   z.string().optional().nullable(),
  disaster_id:   z.string().optional().nullable(),
  user_id:       z.string().optional().nullable(),
});

/** Validates PUT /api/admin/reports/:id body — blanks mean "keep existing". */
const AdminReportUpdateSchema = z.object({
  name:          blankable(z.string()),
  status:        blankable(z.string()),
  lat:           blankable(z.number()),
  lng:           blankable(z.number()),
  medical_notes: blankable(z.string()),
  phone:         blankable(z.string()),
  personal_id:   blankable(z.string()),
  disaster_id:   blankable(z.string()),
});

/** Validates POST /api/admin/disasters body (shape; guards live in the handler). */
const AdminDisasterCreateSchema = z.object({
  type:        z.string().optional().nullable(),
  magnitude:   blankable(z.number()),
  severity:    blankable(z.number()),
  lat:         blankable(z.number()),
  lng:         blankable(z.number()),
  radius_km:   blankable(z.number()),
  description: z.string().optional().nullable(),
  active:      blankable(z.boolean()),
});

/** Validates PUT /api/admin/disasters/:id body — blanks mean "keep existing". */
const AdminDisasterUpdateSchema = z.object({
  type:        blankable(z.string()),
  magnitude:   blankable(z.number()),
  severity:    blankable(z.number()),
  lat:         blankable(z.number()),
  lng:         blankable(z.number()),
  radius_km:   blankable(z.number()),
  description: blankable(z.string()),
  active:      blankable(z.boolean()),
  ended_at:    blankable(z.number()),
});

/** Validates PUT /api/admin/links/:id body (enum guard lives in the handler). */
const AdminLinkUpdateSchema = z.object({
  status: z.string().optional().nullable(),
});

module.exports = {
  IncidentCreateSchema,
  IncidentRespondSchema,
  ResponderProfileSchema,
  AedQuerySchema,
  normalizePhone,
  MissingPersonCreateSchema,
  MissingPersonUpdateSchema,
  isValidHKID,
  isValidHKIDChecksum,
  hkidIsValid,
  normalizeHKID,
  ReportSchema,
  ManualDisasterSchema,
  RescueQuerySchema,
  ReportSearchQuerySchema,
  ShelterQuerySchema,
  ShelterCreateSchema,
  ShelterUpdateSchema,
  UserRegisterSchema,
  UserUpdateSchema,
  LoginSchema,
  LinkRequestSchema,
  SafePlaceCreateSchema,
  SafePlaceQuerySchema,
  DeviceRegisterSchema,
  AdminUserCreateSchema,
  AdminUserUpdateSchema,
  AdminReportCreateSchema,
  AdminReportUpdateSchema,
  AdminDisasterCreateSchema,
  AdminDisasterUpdateSchema,
  AdminLinkUpdateSchema,
};
