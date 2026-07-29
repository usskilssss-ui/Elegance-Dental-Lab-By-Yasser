const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const printController = require('../controllers/printController');

const { verifyToken } = require('../config/jwt');

// Create print job (requester / public / secretary / admin)
router.post('/job', (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = verifyToken(token);
      if (decoded) req.user = { userId: decoded.userId };
    } catch (e) {}
  }
  next();
}, printController.createPrintJob);

// Print Agent updates job status (uses AGENT_SECRET header instead of JWT)
router.patch('/job/:id/status', (req, res, next) => {
  const secret = req.headers['x-agent-secret'];
  if (!secret || secret !== process.env.PRINT_AGENT_SECRET) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }
  next();
}, printController.updateJobStatus);

// Entry screen: human confirm whether paper actually printed
router.patch('/job/:id/confirm', (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = verifyToken(token);
      if (decoded) req.user = { userId: decoded.userId, role: decoded.role };
    } catch (e) {}
  }
  next();
}, printController.confirmPaper);

// List recent jobs — admin only
router.get('/jobs', authenticate, printController.listJobs);

// Pending jobs for Print Agent catch-up (agent secret required)
router.get('/jobs/pending', (req, res, next) => {
  const secret = req.headers['x-agent-secret'];
  if (!secret || secret !== process.env.PRINT_AGENT_SECRET) {
    return res.status(401).json({ success: false, message: 'غير مصرح' });
  }
  next();
}, printController.listPendingJobs);

// List today's jobs for entry screen (finisher/admin — public token optional)
router.get('/jobs/today', (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = require('../config/jwt').verifyToken(token);
      if (decoded) req.user = { userId: decoded.userId, role: decoded.role };
    } catch (e) {}
  }
  next();
}, printController.listTodayJobs);

// Delete a single print job
router.delete('/job/:id', printController.deletePrintJob);

// Delete all print jobs
router.delete('/jobs/all', printController.clearAllJobs);

module.exports = router;
