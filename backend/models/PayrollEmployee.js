const mongoose = require('mongoose');

/** Lab staff for payroll who may not have a system login. */
const payrollEmployeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    jobTitle: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    baseSalary: { type: Number, default: 0, min: 0 },
    defaultPieceRate: { type: Number, default: 0, min: 0 },
    payType: {
      type: String,
      enum: ['fixed', 'piece', 'mixed'],
      default: 'fixed',
    },
    payrollEnabled: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    notes: { type: String, default: '', trim: true },
    /** Optional link to a system User if they also have a login */
    linkedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

payrollEmployeeSchema.index({ name: 1 });
payrollEmployeeSchema.index({ isActive: 1, payrollEnabled: 1 });

module.exports = mongoose.model('PayrollEmployee', payrollEmployeeSchema);
