const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const settingsController = require('../controllers/settingsController');

const router = express.Router();

// Public white-label branding (login page)
router.get('/public', settingsController.getPublicLabSettings);

// Lab config (any authenticated user can read; admin writes)
router.get('/lab', authenticate, settingsController.getLabSettings);
router.put('/lab', authenticate, authorize('admin'), settingsController.updateLabSettings);

router.use(authenticate, authorize('admin'));

router.get('/whatsapp', settingsController.getWhatsAppSettings);
router.put('/whatsapp', settingsController.updateWhatsAppSettings);
router.post('/whatsapp/test', settingsController.testWhatsApp);
router.post('/whatsapp/daily-summary', settingsController.runDailySummaryNow);
router.get('/whatsapp/web/status', settingsController.getWhatsAppWebStatus);
router.post('/whatsapp/web/start', settingsController.startWhatsAppWeb);
router.post('/whatsapp/web/logout', settingsController.logoutWhatsAppWeb);

module.exports = router;
