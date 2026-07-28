const PrintJob = require('../models/PrintJob');
const { getIO } = require('../services/socketService');

// POST /api/print/job  — create a new print job and push to Print Agent
exports.createPrintJob = async (req, res) => {
  try {
    const { printData } = req.body;

    if (!printData || !printData.doctor || !printData.patient) {
      return res.status(400).json({ success: false, message: 'بيانات ناقصة' });
    }

    const job = await PrintJob.create({
      printData,
      status: 'pending',
      createdBy: req.user?.userId || null,
    });

    // Emit to the Print Agent via Socket.IO room 'print-agents'
    const io = getIO();
    if (io) {
      io.to('print-agents').emit('print:new-job', {
        jobId: job._id,
        printData: job.printData,
      });
      // Also broadcast to entry screens so they see the new job in real-time
      io.emit('print:job-created', {
        jobId: job._id,
        printData: job.printData,
        status: job.status,
        createdAt: job.createdAt,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'تم إرسال الريكويست للطباعة',
      jobId: job._id,
    });
  } catch (err) {
    console.error('createPrintJob error:', err);
    return res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
  }
};

// PATCH /api/print/job/:id/status  — called by Print Agent to update status
exports.updateJobStatus = async (req, res) => {
  try {
    const { status, errorMessage } = req.body;
    const validStatuses = ['printing', 'done', 'failed'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'status غير صحيح' });
    }

    const job = await PrintJob.findByIdAndUpdate(
      req.params.id,
      { status, errorMessage: errorMessage || '' },
      { new: true }
    );

    if (!job) {
      return res.status(404).json({ success: false, message: 'الجوب مش موجود' });
    }

    // Broadcast status update to entry screens
    const io = getIO();
    if (io) {
      io.emit('print:job-status-updated', { jobId: job._id, status: job.status });
    }

    return res.json({ success: true, job });
  } catch (err) {
    console.error('updateJobStatus error:', err);
    return res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
  }
};

// GET /api/print/jobs — list recent jobs (admin use)
exports.listJobs = async (req, res) => {
  try {
    const jobs = await PrintJob.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('createdBy', 'name role');

    return res.json({ success: true, jobs });
  } catch (err) {
    console.error('listJobs error:', err);
    return res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
  }
};

// GET /api/print/jobs/today — list today's jobs for entry screen
exports.listTodayJobs = async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const jobs = await PrintJob.find({
      createdAt: { $gte: startOfDay }
    }).sort({ createdAt: 1 });

    return res.json({ success: true, jobs });
  } catch (err) {
    console.error('listTodayJobs error:', err);
    return res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
  }
};

// DELETE /api/print/job/:id — delete a single job
exports.deletePrintJob = async (req, res) => {
  try {
    const job = await PrintJob.findByIdAndDelete(req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'الريكويست غير موجود' });
    }
    const io = getIO();
    if (io) {
      io.emit('print:job-deleted', { jobId: req.params.id });
    }
    return res.json({ success: true, message: 'تم حذف الريكويست' });
  } catch (err) {
    console.error('deletePrintJob error:', err);
    return res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
  }
};

// DELETE /api/print/jobs/all — clear all jobs
exports.clearAllJobs = async (req, res) => {
  try {
    await PrintJob.deleteMany({});
    const io = getIO();
    if (io) {
      io.emit('print:all-jobs-cleared');
    }
    return res.json({ success: true, message: 'تم مسح جميع الريكويستات' });
  } catch (err) {
    console.error('clearAllJobs error:', err);
    return res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
  }
};
