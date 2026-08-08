const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const settingsController = require('../controllers/settingsController');

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/whatsapp', settingsController.getWhatsAppSettings);
router.put('/whatsapp', settingsController.updateWhatsAppSettings);
router.post('/whatsapp/test', settingsController.testWhatsApp);
router.post('/whatsapp/daily-summary', settingsController.runDailySummaryNow);

module.exports = router;
