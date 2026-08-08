const express = require('express');
const router = express.Router();
const customWorkTypeController = require('../controllers/customWorkTypeController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.use(authorize('admin', 'secretary', 'doctor', 'lab'));

router.get('/', customWorkTypeController.list);
router.post('/', customWorkTypeController.create);
router.delete('/:id', customWorkTypeController.remove);

module.exports = router;
