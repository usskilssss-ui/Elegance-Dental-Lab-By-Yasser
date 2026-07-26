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
