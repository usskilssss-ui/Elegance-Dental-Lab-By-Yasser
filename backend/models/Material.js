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
    /** Sell price to doctors (billing). Inventory cost is avgUnitCost. */
    stockQty: { type: Number, default: 0, min: 0 },
    /** Weighted-average purchase cost per unit (EGP). */
    avgUnitCost: { type: Number, default: 0, min: 0 },
    lowStockAlert: { type: Number, default: 0, min: 0 },
    /** Last time a low-stock alert was fired (debounce). */
    lastLowStockAlertAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 100 },
    showInWorkTypes: { type: Boolean, default: true },
    showInCounters: { type: Boolean, default: true },
    color: { type: String, default: '#64748b' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Material', materialSchema);
