const User = require('../models/User');
const DentalCase = require('../models/DentalCase');
const { validationResult } = require('express-validator');
const {
  isClientPortalRole,
  departmentForClientRole,
  normalizeClientRole,
  requesterTypeForRole,
} = require('../utils/clientRoles');

// Get all users (admin). Pass includeInactive=true to list deactivated accounts too.
exports.getAllUsers = async (req, res) => {
  try {
    const { role, status, includeInactive } = req.query;

    const filter = {};
    if (includeInactive !== 'true') {
      filter.isActive = true;
    }
    if (role) filter.role = role;
    if (status) filter.status = status;

    const users = await User.find(filter)
      .select('+loginPasswordVisible')
      .select('-password')
      .sort({ fullName: 1 });

    res.status(200).json({
      success: true,
      data: users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message,
    });
  }
};

// Get user by ID
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user',
      error: error.message,
    });
  }
};

// Update user
exports.updateUser = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { fullName, phone, department, role, password, isActive } = req.body;

    const user = await User.findById(req.params.id).select('+password +loginPasswordVisible');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Only admin can change roles
    if (role && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can change user roles' });
    }

    if (fullName) user.fullName = fullName;
    if (phone !== undefined && phone !== null) user.phone = phone;
    if (department !== undefined) user.department = department;
    if (role && req.user.role === 'admin') user.role = role;

    if (password && typeof password === 'string' && password.length >= 6) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Only admin can set passwords' });
      }
      user.password = password;
      if (isClientPortalRole(role || user.role)) {
        user.loginPasswordVisible = password;
      }
    }

    if (req.user.role === 'admin' && isActive !== undefined) {
      let normalizedIsActive = isActive;
      if (typeof normalizedIsActive === 'string') {
        const lowered = normalizedIsActive.toLowerCase();
        if (lowered === 'true') normalizedIsActive = true;
        if (lowered === 'false') normalizedIsActive = false;
      }

      if (typeof normalizedIsActive !== 'boolean') {
        return res.status(400).json({ message: 'isActive must be a boolean' });
      }

      user.isActive = normalizedIsActive;
      if (!normalizedIsActive) {
        user.status = 'offline';
        user.lastSeen = new Date();
      }
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        department: user.department,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update user',
      error: error.message,
    });
  }
};

// Update user status
exports.updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!['online', 'offline', 'idle'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        status,
        lastSeen: new Date(),
      },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      message: 'User status updated',
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update user status',
      error: error.message,
    });
  }
};

// Delete user (soft delete)
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete user',
      error: error.message,
    });
  }
};

// Reset doctor password (admin or secretary — doctors only)
exports.resetDoctorPassword = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { password } = req.body;
    const user = await User.findById(req.params.id).select('+password +loginPasswordVisible');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (!isClientPortalRole(user.role)) {
      return res.status(403).json({ message: 'يمكن إعادة تعيين كلمة مرور الدكاترة والطلاب والمعامل فقط' });
    }

    user.password = String(password);
    user.loginPasswordVisible = String(password);
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم تحديث كلمة مرور الدكتور',
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to reset password',
      error: error.message,
    });
  }
};

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setRequesterTypeInNotes(notes, requesterType) {
  const prefix = '__META__\n';
  if (!notes || typeof notes !== 'string') {
    return `${prefix}${JSON.stringify({ requesterType })}`;
  }
  const normalized = notes.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('__META__')) return notes;
  const rest = normalized.slice('__META__'.length).replace(/^\r?\n/, '');
  try {
    const meta = JSON.parse(rest) || {};
    meta.requesterType = requesterType;
    return `${prefix}${JSON.stringify(meta)}`;
  } catch {
    return notes;
  }
}

async function retagCasesForClientName(fullName, role) {
  const name = String(fullName || '').trim();
  const requesterType = requesterTypeForRole(role);
  if (!name) return 0;

  const nameRe = new RegExp(`^${escapeRegex(name)}$`, 'i');
  const notesRe = new RegExp(`"doctor"\\s*:\\s*"${escapeRegex(name)}"`, 'i');
  const cases = await DentalCase.find({
    $or: [{ referringDoctor: nameRe }, { notes: notesRe }],
  });

  let updated = 0;
  for (const dentalCase of cases) {
    const nextNotes = setRequesterTypeInNotes(dentalCase.notes || '', requesterType);
    const changed =
      dentalCase.requesterType !== requesterType || String(dentalCase.notes || '') !== nextNotes;
    if (!changed) continue;
    dentalCase.requesterType = requesterType;
    dentalCase.notes = nextNotes;
    await dentalCase.save();
    updated += 1;
  }
  return updated;
}

// Admin or secretary: convert an existing doctor/student/lab account and retag their cases
exports.convertClientRole = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const role = normalizeClientRole(req.body?.role);
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (!isClientPortalRole(user.role)) {
      return res.status(403).json({ message: 'يمكن تحويل حسابات الدكاترة والطلاب والمعامل فقط' });
    }

    if (user.role !== role) {
      user.role = role;
      user.department = departmentForClientRole(role);
      await user.save();
    }

    const updatedCases = await retagCasesForClientName(user.fullName, role);

    res.status(200).json({
      success: true,
      message:
        role === 'student'
          ? 'تم تحويل الحساب إلى طالب'
          : role === 'lab'
            ? 'تم تحويل الحساب إلى معمل'
            : 'تم تحويل الحساب إلى دكتور',
      updatedCases,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        department: user.department,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to convert account',
      error: error.message,
    });
  }
};

// Get users by role
exports.getUsersByRole = async (req, res) => {
  try {
    const { role } = req.params;

    const validRoles = [
      'admin',
      'secretary',
      'designer',
      'finisher',
      'requester',
      'doctor',
      'student',
      'lab',
    ];

    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const users = await User.find({ role, isActive: true }).select('-password').sort({ fullName: 1 });

    res.status(200).json({
      success: true,
      data: users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message,
    });
  }
};