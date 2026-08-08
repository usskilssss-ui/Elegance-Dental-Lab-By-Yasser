const mongoose = require('mongoose');

const appSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'app',
    },
    whatsapp: {
      enabled: { type: Boolean, default: false },
      provider: {
        type: String,
        enum: ['', 'ultramsg', 'meta'],
        default: 'ultramsg',
      },
      token: { type: String, default: '' },
      instanceId: { type: String, default: '' }, // UltraMsg
      phoneNumberId: { type: String, default: '' }, // Meta
      dailyHour: { type: Number, default: 18 },
      labName: { type: String, default: 'Elegance Dental Lab' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppSettings', appSettingsSchema);
