const mongoose = require('mongoose');

const payrollPaymentSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    employeeName: { type: String, required: true, trim: true },
    employeeRole: { type: String, default: '', trim: true },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },
    /** Fixed monthly salary portion */
    baseAmount: { type: Number, default: 0, min: 0 },
    /** Manual bonus / incentive */
    incentiveAmount: { type: Number, default: 0, min: 0 },
    /** Piece-rate: units × rate */
    pieceUnits: { type: Number, default: 0, min: 0 },
    pieceRate: { type: Number, default: 0, min: 0 },
    pieceAmount: { type: Number, default: 0, min: 0 },
    deductions: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['draft', 'paid'],
      default: 'draft',
    },
    paidAt: { type: Date },
    notes: { type: String, default: '', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true }
);

payrollPaymentSchema.index({ year: -1, month: -1, employee: 1 }, { unique: true });

module.exports = mongoose.model('PayrollPayment', payrollPaymentSchema);
