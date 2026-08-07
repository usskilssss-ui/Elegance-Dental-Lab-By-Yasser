const express = require('express');
const router = express.Router();
const cashEntryController = require('../controllers/cashEntryController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.use(authorize('admin'));

router.get('/', cashEntryController.getEntries);
router.post('/', cashEntryController.addEntry);
router.delete('/:id', cashEntryController.deleteEntry);

module.exports = router;
