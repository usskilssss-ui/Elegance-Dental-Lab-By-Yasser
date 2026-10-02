const DoctorPayment = require('../models/DoctorPayment');

function isChargeEntry(doc) {
  const type = String(doc?.entryType || '').toLowerCase().trim();
  if (type === 'charge') return true;
  const notes = String(doc?.notes || '');
  return notes.startsWith('[CHARGE]') || notes.startsWith('[زيادة]');
}

exports.getAllPayments = async (req, res) => {
  try {
    const { doctor, entryType } = req.query;
    let filter = {};
    if (doctor) {
      // Normalize and find case-insensitive matching if needed, or exact matching
      filter.doctorName = { $regex: new RegExp('^' + doctor.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') };
    }
    const payments = await DoctorPayment.find(filter).sort({ paymentDate: -1 });
    let data = payments;
    if (entryType === 'payment' || entryType === 'charge') {
      data = payments.filter((p) =>
        entryType === 'charge' ? isChargeEntry(p) : !isChargeEntry(p)
      );
    }
    // Ensure clients always see a concrete entryType (repair stripped legacy rows via notes marker)
    data = data.map((p) => {
      const obj = typeof p.toObject === 'function' ? p.toObject() : { ...p };
      obj.entryType = isChargeEntry(obj) ? 'charge' : 'payment';
      return obj;
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addPayment = async (req, res) => {
  try {
    const { doctorName, amount, paymentDate, notes, entryType } = req.body;
    if (!doctorName || amount === undefined || amount === null) {
      return res.status(400).json({ success: false, message: 'doctorName and amount are required' });
    }

    const normalizedName = doctorName.trim();
    if (amount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
    }

    const rawType = String(entryType || 'payment').toLowerCase().trim();
    if (rawType && rawType !== 'payment' && rawType !== 'charge') {
      return res.status(400).json({ success: false, message: 'entryType must be payment or charge' });
    }

    let normalizedNotes = String(notes || '').trim();
    // Notes marker alone is enough to request a charge (older clients / stripped body fields)
    const type =
      rawType === 'charge' || isChargeEntry({ notes: normalizedNotes, entryType: rawType })
        ? 'charge'
        : 'payment';

    if (type === 'charge') {
      if (!normalizedNotes.startsWith('[CHARGE]') && !normalizedNotes.startsWith('[زيادة]')) {
        normalizedNotes = normalizedNotes ? `[CHARGE] ${normalizedNotes}` : '[CHARGE]';
      }
    }

    let payment = await DoctorPayment.create({
      doctorName: normalizedName,
      amount: Number(amount),
      paymentDate: paymentDate || new Date(),
      notes: normalizedNotes,
      entryType: type,
      caseId: req.body?.caseId || null,
    });

    // Force-repair if schema/default left it as payment despite charge intent
    if (type === 'charge' && !isChargeEntry(payment)) {
      payment = await DoctorPayment.findByIdAndUpdate(
        payment._id,
        { $set: { entryType: 'charge', notes: normalizedNotes } },
        { new: true }
      );
    }

    try {
      const AuditLog = require('../models/AuditLog');
      await AuditLog.create({
        caseId: payment.caseId || undefined,
        caseNumber: payment.caseId ? String(payment.caseId) : 'ACCOUNT',
        action: type === 'charge' ? 'doctor_charge_added' : 'doctor_payment_added',
        performedBy: req.user?.id,
        performedByName: req.user?.fullName || '',
        details: {
          newValue: {
            doctorName: normalizedName,
            amount: Number(amount),
            entryType: type,
            paymentId: String(payment._id),
          },
        },
      });
    } catch (auditErr) {
      console.warn('AuditLog for doctor payment failed:', auditErr.message);
    }

    if (type === 'charge' && payment && !isChargeEntry(payment)) {
      await DoctorPayment.findByIdAndDelete(payment._id);
      return res.status(500).json({
        success: false,
        message: 'Failed to persist charge entryType — check DoctorPayment schema deploy',
      });
    }

    const data = typeof payment.toObject === 'function' ? payment.toObject() : { ...payment };
    data.entryType = type;
    data.notes = normalizedNotes;

    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deletePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await DoctorPayment.findByIdAndDelete(id);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }
    res.status(200).json({ success: true, message: 'Payment deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
