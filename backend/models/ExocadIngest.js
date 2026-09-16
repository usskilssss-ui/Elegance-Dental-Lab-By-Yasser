const mongoose = require('mongoose');

/**
 * Raw Exocad project snapshots from the local agent (idempotent by exocadCaseId).
 * Matching/apply is separate and never creates DentalCase rows.
 */
const exocadIngestSchema = new mongoose.Schema(
  {
    exocadCaseId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    practiceName: { type: String, default: '', trim: true },
    patientName: { type: String, default: '', trim: true },
    patientId: { type: String, default: '', trim: true },
    practiceId: { type: String, default: '', trim: true },
    designedTeeth: { type: [String], default: [] },
    designedUnits: { type: Number, default: 0 },
    reconstructionTypes: { type: [String], default: [] },
    sourceFile: { type: String, default: '' },
    projectFolder: { type: String, default: '' },
    projectDateTime: { type: Date, default: null },
    rawToothCount: { type: Number, default: 0 },
    matchedCaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DentalCase',
      default: null,
    },
    syncStatus: {
      type: String,
      enum: [
        'PENDING',
        'MATCHED',
        'NO_MATCH',
        'MULTIPLE_MATCHES',
        'NEEDS_REVIEW',
        'SYNCED',
        'SYNC_ERROR',
      ],
      default: 'PENDING',
      index: true,
    },
    lastError: { type: String, default: '' },
    lastIngestedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ExocadIngest', exocadIngestSchema);
