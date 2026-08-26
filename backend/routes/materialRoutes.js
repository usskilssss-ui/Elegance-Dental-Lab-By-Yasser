const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const materialController = require('../controllers/materialController');

const router = express.Router();

// Active catalog for forms (any logged-in user)
router.get('/', authenticate, materialController.listMaterials);

// Admin CRUD
router.post('/', authenticate, authorize('admin'), materialController.createMaterial);
router.put('/:id', authenticate, authorize('admin'), materialController.updateMaterial);
router.delete('/:id', authenticate, authorize('admin'), materialController.deleteMaterial);

module.exports = router;
