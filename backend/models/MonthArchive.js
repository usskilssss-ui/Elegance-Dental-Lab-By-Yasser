const mongoose = require('mongoose');

const monthArchiveSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    closedAt: { type: Date, default: null },
    exportedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    summary: {
      totalCases: { type: Number, default: 0 },
      exitedCases: { type: Number, default: 0 },
      activeCasesKept: { type: Number, default: 0 },
      deletedExitedCases: { type: Number, default: 0 },
      deletedPayments: { type: Number, default: 0 },
      byDoctor: { type: Array, default: [] },
      byTypeUnits: { type: Object, default: {} },
      totalAmount: { type: Number, default: 0 },
      paidAmount: { type: Number, default: 0 },
      unpaidAmount: { type: Number, default: 0 },
    },
    confirmPhrase: { type: String, default: '' },
  },
  { timestamps: true }
);

monthArchiveSchema.index({ year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('MonthArchive', monthArchiveSchema);
