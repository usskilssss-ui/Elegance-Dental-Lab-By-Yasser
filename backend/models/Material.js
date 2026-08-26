const mongoose = require('mongoose');

/**
 * Lab-configurable material / work-type catalog.
 * Replaces hardcoded Zircon/Emax/Peek lists across pricing & counters.
 */
const materialSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    label: { type: String, required: true, trim: true },
    labelAr: { type: String, default: '', trim: true },
    /** Substrings matched against caseType parts (lowercase) */
    matchKeywords: { type: [String], default: [] },
    defaultPrice: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 100 },
    showInWorkTypes: { type: Boolean, default: true },
    showInCounters: { type: Boolean, default: true },
    color: { type: String, default: '#64748b' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Material', materialSchema);
