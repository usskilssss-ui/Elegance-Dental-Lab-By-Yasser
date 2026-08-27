const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email',
      ],
    },
    phone: {
      type: String,
      required: [true, 'Please provide a phone number'],
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: 6,
      select: false,
    },
    /** Optional 4–6 digit PIN for doctors (faster mobile login). */
    pinHash: {
      type: String,
      default: '',
      select: false,
    },
    /** Admin-visible password copy (doctors). Auth still uses hashed `password`. */
    loginPasswordVisible: {
      type: String,
      default: '',
      select: false,
    },
    role: {
      type: String,
      enum: [
        'admin',
        'secretary',
        'designer',
        'finisher',
        'requester',
        'doctor',
        'scanner1',
        'scanner2',
        'scanner3',
      ],
      default: 'secretary',
      required: true,
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'idle'],
      default: 'offline',
    },
    department: {
      type: String,
      default: '',
    },
    lastSeen: {
      type: Date,
      default: new Date(),
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    /** Payroll: include in salary sheet */
    payrollEnabled: {
      type: Boolean,
      default: false,
    },
    /** Fixed monthly salary (EGP) */
    baseSalary: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Default piece rate (EGP per unit) when using piece / mixed pay */
    defaultPieceRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** fixed | piece | mixed */
    payType: {
      type: String,
      enum: ['fixed', 'piece', 'mixed'],
      default: 'fixed',
    },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.comparePin = async function (enteredPin) {
  if (!this.pinHash) return false;
  return await bcrypt.compare(String(enteredPin), this.pinHash);
};

module.exports = mongoose.model('User', userSchema);
