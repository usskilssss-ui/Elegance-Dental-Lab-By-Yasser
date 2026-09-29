const mongoose = require('mongoose');

const DoctorPaymentSchema = new mongoose.Schema({
  doctorName: {
    type: String,
    required: true,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  /** payment = credit against due; charge = add to doctor's invoice/due */
  entryType: {
    type: String,
    enum: ['payment', 'charge'],
    default: 'payment',
    index: true,
  },
  paymentDate: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    default: ''
  }
}, { timestamps: true });

module.exports = mongoose.model('DoctorPayment', DoctorPaymentSchema);
