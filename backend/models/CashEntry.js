const mongoose = require('mongoose');

const CashEntrySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['income', 'expense'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    category: {
      type: String,
      trim: true,
      default: '',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    /** When set, this income row was auto-created from a doctor/lab account payment */
    doctorPaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DoctorPayment',
      default: null,
      index: true,
    },
    caseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DentalCase',
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

CashEntrySchema.index({ date: -1 });
CashEntrySchema.index({ type: 1, date: -1 });

module.exports = mongoose.model('CashEntry', CashEntrySchema);
