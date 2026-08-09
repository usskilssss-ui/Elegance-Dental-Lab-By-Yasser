const mongoose = require('mongoose');

const DoctorPricingSchema = new mongoose.Schema({
  doctorName: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  // Mixed so custom / added work types can store prices as dynamic keys
  prices: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({
      emax: 1000,
      germanZircon: 850,
      zircon: 700,
      titanium: 2200,
      peek: 1700,
      pmma: 250,
      nightGuard: 300,
      mockup: 250,
      wax: 0,
      ring: 0,
      tryIn: 0,
      removableDenture: 0,
    }),
  },
}, { timestamps: true });

module.exports = mongoose.model('DoctorPricing', DoctorPricingSchema);
