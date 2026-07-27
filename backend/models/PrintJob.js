const mongoose = require('mongoose');

const printJobSchema = new mongoose.Schema(
  {
    printData: {
      doctor:     { type: String, required: true },
      patient:    { type: String, required: true },
      caseType:   { type: String, default: '' },
      workType:   { type: String, default: '' },
      workDetail: { type: String, default: '' },
      color:      { type: String, default: '' },
      quantity:   { type: Number, default: 0 },
      caseNumber: { type: String, default: '' },
      printDate:  { type: String, default: '' },
    },
    status: {
      type: String,
      enum: ['pending', 'printing', 'done', 'failed'],
      default: 'pending',
    },
    errorMessage: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Auto-delete jobs older than 7 days
printJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('PrintJob', printJobSchema);
