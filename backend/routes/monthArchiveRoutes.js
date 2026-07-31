const express = require('express');
const monthArchiveController = require('../controllers/monthArchiveController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(authorize('admin'));

router.get('/export', monthArchiveController.exportMonthData);
router.get('/', monthArchiveController.listArchives);
router.post('/close', monthArchiveController.closeMonth);

module.exports = router;
