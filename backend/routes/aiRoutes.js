const express = require('express');
const aiAssistantController = require('../controllers/aiAssistantController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.get('/assistant', authorize('admin'), aiAssistantController.getAiAssistantAnswer);

module.exports = router;
