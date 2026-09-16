const mongoose = require('mongoose');

/**
 * Persistent Arabic/internal doctor name ↔ Exocad practice/doctor name(s).
 * Prefer this over fuzzy string matching for auto-sync.
 */
const exocadDoctorMappingSchema = new mongoose.Schema(
  {
    /** Name as stored in our system (referringDoctor / notes.doctor) */
    internalDoctorName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    /** Optional link to User (role=doctor) */
    doctorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    /** Names/aliases as they appear in Exocad PracticeName (or folder) */
    exocadNames: {
      type: [String],
      default: [],
    },
    active: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

exocadDoctorMappingSchema.index(
  { internalDoctorName: 1 },
  { unique: true, collation: { locale: 'ar', strength: 1 } }
);

module.exports = mongoose.model('ExocadDoctorMapping', exocadDoctorMappingSchema);
