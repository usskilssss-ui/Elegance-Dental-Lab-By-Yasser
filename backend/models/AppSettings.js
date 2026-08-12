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
        enum: ['', 'ultramsg', 'meta', 'waweb'],
        default: 'ultramsg',
      },
      token: { type: String, default: '' },
      instanceId: { type: String, default: '' }, // UltraMsg
      phoneNumberId: { type: String, default: '' }, // Meta
      dailyHour: { type: Number, default: 18 },
      labName: { type: String, default: 'Elegance Dental Lab' },
      // Message templates — placeholders: {lab} {caseNumber} {patient} {count} {list}
      msgCompleted: {
        type: String,
        default:
          '{lab}\nحالة ({patient})\n{workType} — {quantity} قطعة\nجاهزة للاستلام تواصل مع المعمل لاستلام الحالة',
      },
      msgExited: {
        type: String,
        default:
          '{lab}\nحالة ({patient})\n{workType} — {quantity} قطعة\nتم التسليم / خرجت من المعمل',
      },
      msgDaily: {
        type: String,
        default:
          '{lab} — ملخص يومي\nعندك {count} حالات جاهزة للاستلام.\n{list}',
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppSettings', appSettingsSchema);
