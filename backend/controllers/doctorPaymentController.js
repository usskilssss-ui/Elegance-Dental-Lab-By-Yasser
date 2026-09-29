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
    if (rawType !== 'payment' && rawType !== 'charge') {
      return res.status(400).json({ success: false, message: 'entryType must be payment or charge' });
    }
    const type = rawType === 'charge' ? 'charge' : 'payment';

    let normalizedNotes = notes || '';
    if (type === 'charge') {
      const n = String(normalizedNotes || '').trim();
      if (!n.startsWith('[CHARGE]') && !n.startsWith('[زيادة]')) {
        normalizedNotes = n ? `[CHARGE] ${n}` : '[CHARGE]';
      }
    }

    const payment = await DoctorPayment.create({
      doctorName: normalizedName,
      amount: Number(amount),
      paymentDate: paymentDate || new Date(),
      notes: normalizedNotes,
      entryType: type,
    });

    // Guard: if schema somehow dropped entryType, fail loudly instead of misfiling as payment
    if (type === 'charge' && String(payment.entryType || '') !== 'charge') {
      await DoctorPayment.findByIdAndDelete(payment._id);
      return res.status(500).json({
        success: false,
        message: 'Failed to persist charge entryType — check DoctorPayment schema deploy',
      });
    }

    const data = typeof payment.toObject === 'function' ? payment.toObject() : payment;
    data.entryType = type;

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
