const mongoose = require('mongoose');

/**
 * Per-doctor price overrides. Keys match Material.key.
 * Stored as Mixed so labs can add custom materials without schema migrations.
 */
const DoctorPricingSchema = new mongoose.Schema(
  {
    doctorName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    prices: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DoctorPricing', DoctorPricingSchema);
