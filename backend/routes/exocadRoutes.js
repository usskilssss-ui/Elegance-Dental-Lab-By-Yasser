const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/exocadController');

// Local Exocad agent (x-agent-secret) — no JWT
router.post('/ingest', ctrl.requireAgentSecret, ctrl.ingest);
router.post('/parse-preview', ctrl.requireAgentSecret, ctrl.parsePreview);

// Staff
router.get(
  '/cases/:caseId',
  authenticate,
  authorize('admin', 'secretary', 'designer'),
  ctrl.getCaseStatus
);
router.post(
  '/cases/:caseId/sync',
  authenticate,
  authorize('admin', 'secretary', 'designer'),
  ctrl.syncCase
);
router.post(
  '/cases/:caseId/confirm',
  authenticate,
  authorize('admin', 'secretary', 'designer'),
  ctrl.confirmCaseMatch
);

router.get('/ingests', authenticate, authorize('admin', 'designer'), ctrl.listIngests);

router.get(
  '/doctor-mappings',
  authenticate,
  authorize('admin', 'secretary'),
  ctrl.listDoctorMappings
);
router.post('/doctor-mappings', authenticate, authorize('admin'), ctrl.upsertDoctorMapping);
router.delete(
  '/doctor-mappings/:id',
  authenticate,
  authorize('admin'),
  ctrl.deleteDoctorMapping
);

module.exports = router;
