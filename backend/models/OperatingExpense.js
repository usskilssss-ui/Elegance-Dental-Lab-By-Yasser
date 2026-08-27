const mongoose = require('mongoose');

const operatingExpenseSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ['rent', 'utilities', 'maintenance', 'delivery', 'supplies', 'other'],
      default: 'other',
    },
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    expenseDate: { type: Date, required: true, default: Date.now },
    notes: { type: String, default: '', trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true }
);

operatingExpenseSchema.index({ expenseDate: -1 });
operatingExpenseSchema.index({ category: 1, expenseDate: -1 });

module.exports = mongoose.model('OperatingExpense', operatingExpenseSchema);
