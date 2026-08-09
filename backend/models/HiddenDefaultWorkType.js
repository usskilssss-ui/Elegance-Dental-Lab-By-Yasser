const mongoose = require('mongoose');

/** Built-in work types the admin/secretary chose to hide from the picker. */
const hiddenDefaultWorkTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('HiddenDefaultWorkType', hiddenDefaultWorkTypeSchema);
