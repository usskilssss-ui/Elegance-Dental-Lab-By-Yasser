const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const backupController = require('../controllers/backupController');
const { r2Configured, createPresignedPutUrl } = require('../services/r2StorageService');

const router = express.Router();

router.use(authenticate);

router.get('/export', authorize('admin'), backupController.exportBackup);

/** Presigned R2 upload for case scans (falls back with clear error if not configured). */
router.post('/presign-ply', authorize('admin', 'secretary', 'doctor', 'student', 'lab'), async (req, res) => {
  try {
    if (!r2Configured()) {
      return res.status(501).json({
        success: false,
        code: 'R2_NOT_CONFIGURED',
        message:
          'Cloud storage (R2) is not configured. Set R2_* env vars on Railway, or use local upload-ply.',
      });
    }
    const caseId = String(req.body?.caseId || '').trim();
    const fileName = String(req.body?.fileName || 'scan.ply').replace(/[^\w.\-()+ ]/g, '_').slice(0, 180);
    const contentType = String(req.body?.contentType || 'application/octet-stream');
    if (!caseId) {
      return res.status(400).json({ success: false, message: 'caseId required' });
    }
    const key = `cases/${caseId}/${Date.now()}-${fileName}`;
    const signed = await createPresignedPutUrl(key, contentType, 900);
    return res.json({ success: true, ...signed });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Presign failed',
      code: error.code,
    });
  }
});

module.exports = router;
